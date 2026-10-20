# A682 changed test checks

Existing venue folders require reset/reseed for the required unit staff fields. No venue reset
or A760 squash was executed.

You can review the deliberate existing-check changes below alongside the
[approved design](../superpowers/specs/2026-10-17-a682-translations-design.md#2026-10-17-closure-unit-a-and-spanish-a)
and [implementation plan](../superpowers/plans/2026-10-17-a682-translations.md). Each checkpoint
retains its before/after evidence and qualifications. Its line numbers and completion status
refer to that checkpoint; later entries and the final source supersede earlier intermediate
contracts. The unit migration was regenerated as `catalogue/0035_unit_staff_identity`; earlier
`0033` references identify its original generated name.

The final English-only pass renames scenario text and its expected values together. Character
byte-limit examples retain their multibyte data, accent-insensitive search retains diacritics,
and price, quantity, VAT, permission and fiscal expected values stay unchanged. Spanish UI
expectations read the translation catalogue. The final pass also adds explicit unit staff fields
to measure-switch setup and canonicalizes the selected-variant nutrition fixture key to `es`.
Those fixture corrections retain all existing assertions.

This is an audit of checks, not evidence of live hardware or external fiscal acceptance.

## Checkpoint 20261017-183630

### A682 — Changed test checks (Task2 and catalogue projection step)

Authority: owner unit A at16:25, Spanish A at16:40, explicit unit-migration reset YES recorded in campaign questions; executable A682 plan Tasks2–3. No PR exists yet. Eventual PR FIRST LINE: **Existing venue folders must be reset/reseeded.** No venue reset or A760 execution was performed.

- `scripts/migration-upgrade.test.ts:362`: adds ONLY catalogue/0033_unit_staff_identity to RESETS with BOTH exact refusal fragments (`ALTER TABLE `units`ADD`staff_name` text NOT NULL` and `Cannot add a NOT NULL column with default value NULL`). Existing mismatch/refusal/empty restart checks unchanged. Observed upgrade RED3pass1fail; approved declaration GREEN433 across seven root suites.
- `packages/catalogue/src/units.operations.test.ts`: five old matcher expressions affected. Empty/missing translated abbreviation or default name and last-map clear formerly refused unit.translation_required; now exact saved/read-back maps retain the explicit staff pair. English name plus Spanish missing is allowed when the submitted language is enabled. Staff-only fields remain required. Existing single SELECT budget is retained and passes (unit+configuration read joined on updates).
- `packages/catalogue/src/content-translation-writes.test.ts`: UNIT ONLY in the existing-writer table now accepts English-only text and checks the saved name plus both staff fields; the explicit companion step still checks exact resolved maps. Other kinds retain their existing refusal checks for later Task4.
- `apps/server/src/units-api.test.ts`: exact create shape gains required staffName/staffAbbreviation (every existing key/value retained). French-only inputs in two old refusal cases still refuse because French is disabled, now content.translation_invalid with empty params instead of unit.translation_required with a default-gap field/language. New explicit-empty-map route and exact field-specific invalid staff cases test the new contract. One nested request-body addition also changes a matcher source expression without changing their outcome.
- `packages/catalogue/src/operations.test.ts` (two saved unit whole shapes) and `extra-projection.test.ts` (one whole item/real unit shape) gain exact staff fields with every previous member unchanged. Three added real projection cases use staff Mass/M and customer Customer weight/CW and check all unit fields.
- `units.db.test.ts`'s rollback expectation and one units.operations expected call include the new explicit required fixture inputs; existing rollback and get/list assertions retained.

Fixtures: explicit staff pairs added to every audited direct createUnit/insert(units) fixture and three raw unit insert fixtures; no runtime defaults or values derived from translated fields. `content-languages.test.ts` declares its initial en/fr languages. The two Valencian fixtures and one publication fixture now plant exact stored unit rows, preserving their existing disabled translated keys and original configuration assertions. G-shared eight unit data literals were byte-identical in G's current tree before their additive fields (peer-unit-literal-audit.json); foreign order functions were not changed.

assertion-audit.json compares matcher AST expressions, not fixture equivalence: 5317 of5330 old expressions remain structurally identical across changed test files. Thirteen changed expressions are the authorized behavior/whole-shape changes or nested fixture-input additions described above. The full catalogue run passed2187 with all coverage bars; server unit/configuration156, other server fixture511+415, venue134+204, recipes36, protected fiscal20 passed. New focused controls removed five separate behaviors in an installed candidate, all caught; restored114pass and source manifest equal. Fiscal protected files unchanged vs origin/main. Server typecheck still has THREE Task3 contract/fixture errors (modifier-selection.test.ts166,772; working-order.ts392); no full branch/type/CI/readiness claim.

## Checkpoint 20261017-190233

### Changed test checks — A682 Task3 (no PR yet)

Authority: approved unit A / Spanish A, and implementation plan Task3. The future PR must include this list and the preceding Task1/Task2 inventories. Existing venue folders must be reset/reseeded in that PR’s first line.

The source comparison is structural, not proof that a fixture is semantically equivalent. All original price/tax/payment/quantity/permission/fiscal assertions remain; the two unknown-unit fixtures keep empty staff text and their original quantity-only checks.

- Unit form: visibly required fields, local refusal/focus/recovery checks move from the default translated pair to the required staff pair. Missing newly selected default text now saves exact unchanged maps plus staff fields; optional fields are still omitted rather than filled from placeholders.
- Complete unit request/read shapes gain exactly staffName/staffAbbreviation, including API client JSON bodies and submitted/unsaved scopes. Unit offer static contract also requires both. Fields are explicit fixtures, not copied from translations.
- Unit labels: a missing translated abbreviation resolves its own staff abbreviation instead of the full name, no label, or the unit id. Product editor choice combines independently resolved name and abbreviation. Price labels continue checking exact strings, with literal replacement-pattern text moved to the displayed staff abbreviation fixture.
- Catalogue screen: four internal unitLanguage propagation assertions across three cases become three parameterized checks of actual rendered price-unit labels: disabled interface language uses default, empty enabled-list read retains default, and interface language precedes the first-listed language. Retired unitLanguage is removed from its traced screen/browser/list consumers.
- Product editor tests explicitly establish their English-default / Catalan-default content configuration; existing translation expectations otherwise remain. Extras label cases explicitly set and restore their interface locale.

Initial Task3 audit: 16995 existing matcher expressions; 16954 exact and 9 staff-only whole-shape additions. Read assertion-audit.json for every before/after and source line. Counts are this receipt, not a standing rule.

Raw per-file old checks:

#### apps/dashboard/src/api/client.test.ts

- BASE 731: `expect(api.createUnit({ name: { en: "portion" }, abbreviation: { en: "pt" }, precision: 2 })).resolves.toEqual(unit)`
- BASE 739: `expect(fetchImpl.mock.calls.map(([url, init]) => [url, init.method, init.body])).toEqual([     ["/management-api/units", "GET", undefined],     [         "/management-api/units",         "POST",         JSON.stringify({ name: { en: "portion" }, abbreviation: { en: "pt" }, precision: 2 }),     ],     ["/management-api/units/u1", "PATCH", JSON.stringify({ precision: 1 })],     ["/management-api/units/u1", "DELETE", undefined], ])`

#### apps/dashboard/src/screens/catalogue-screen.test.ts

- BASE 3367: `expect(list(el).unitLanguage).toBe("es")`
- BASE 3370: `expect(products.unitLanguage).toBe("es")`
- BASE 3380: `expect(list(el).unitLanguage).toBe("es")`
- BASE 3392: `expect(list(el).unitLanguage).toBe("es")`

#### apps/dashboard/src/widgets/catalogue-forms.unsaved.test.ts

- BASE 142: `expect(app.submitted).toEqual([     { name: { en: "Each" }, abbreviation: { en: "ea" }, precision: 0 }, ])`

#### apps/dashboard/src/widgets/device-home-preview.test.ts

- BASE 377: `expect(tile(el, "structure", "Water").querySelector(".price")!.textContent!.trim()).toBe(`${formatMoney("3.00", currentLocale())}/unit-each`)`

#### apps/dashboard/src/widgets/extra-list-form.test.ts

- BASE 1762: `expect([first.tagName, first.unit, second.unit]).toEqual(["WT-PRICE-INPUT", "kg", "Portion"])`
- BASE 1776: `expect(field<HTMLElementTagNameMap["wt-price-input"]>(el, "item-0-price").unit).toBe("kilo")`
- BASE 1777: `expect(field<HTMLElementTagNameMap["wt-price-input"]>(el, "item-1-price").unit).toBe("Ración")`

#### apps/dashboard/src/widgets/product-editor.test.ts

- BASE 347: `expect(option.label).toBe("Portion")`

#### apps/dashboard/src/widgets/product-list.test.ts

- BASE 1755: `expect(unit("bun")).toBe("/ bandeja")`
- BASE 1756: `expect(unit("bun:small")).toBe("/ bandeja")`

#### apps/dashboard/src/widgets/unit-form.save-state.test.ts

- BASE 145: `expect(errorOf(el, "abbreviation-es")).toBe(t("units.abbreviation_required"))`

#### apps/dashboard/src/widgets/unit-form.test.ts

- BASE 227: `expect(el.shadowRoot!.querySelector("[data-test=name-es]")!.hasAttribute("required")).toBe(true)`
- BASE 233: `expect(el.shadowRoot!.querySelector("[data-test=abbreviation-es]")!.hasAttribute("required")).toBe(true)`
- BASE 274: `expect(el.shadowRoot!.querySelector("[data-test=abbreviation-en]")!.getAttribute("error")).not.toBe("")`
- BASE 302: `expect(submit).not.toHaveBeenCalled()`
- BASE 303: `expect(el.shadowRoot!.querySelector("[data-test=abbreviation-en]")!.getAttribute("error")).toBe(t("units.abbreviation_required"))`
- BASE 325: `expect(submit).not.toHaveBeenCalled()`
- BASE 326: `expect(el.shadowRoot!.querySelector("[data-test=name-en]")!.getAttribute("error")).toBe(t("units.name_required"))`
- BASE 456: `expect(submit.mock.calls[0]![0].detail).toStrictEqual({     value: { name: { es: "caja" }, abbreviation: { es: "cj" }, precision: 0 }, })`
- BASE 546: `expect(errorOf(el, "name-es")).toBe("")`
- BASE 547: `expect(errorOf(el, "abbreviation-es")).toBe(t("units.abbreviation_required"))`
- BASE 552: `expect(errorOf(el, "name-es")).toBe(t("units.name_required"))`
- BASE 638: `expect(errorOf(el, "name-es")).toBe(t("units.name_required"))`
- BASE 644: `expect(errorOf(el, "name-es")).toBe("")`
- BASE 650: `expect(errorOf(el, "abbreviation-es")).toBe("")`

#### apps/till/src/widgets/product-name.test.ts

- BASE 188: `expect(unitName(product({     unit: {         id: "d6a9d42f-9252-4a83-b722-0fd7f951e9a0",         name: { es: "Caja" },         abbreviation: { en: "box" },         precision: 0,         hardwareUnit: null,     }, }), "es-ES")).toBe("Caja")`
- BASE 224: `expect(unitName(product({     unit: {         id: "d6a9d42f-9252-4a83-b722-0fd7f951e9a0",         name: { en: "Box" },         abbreviation: { en: "box" },         precision: 0,         hardwareUnit: null,     }, }), "es-ES")).toBe("")`

#### packages/catalogue/src/offered-modifiers.test.ts

- BASE 29: `expectTypeOf<OfferedExtraItem["unit"]>().toEqualTypeOf<{     id: string;     name: Record<string, string>;     abbreviation: Record<string, string>;     precision: number;     hardwareUnit: "kg" | "g" | "mg" | null; }>()`

## Checkpoint 20261017-201215

### A682 Task4 product/variant substep — Changed test checks, no PR yet

Authority: approved A682 unit A and Spanish A; plan Task4; plan "Identity, optional maps and expected facts" explicitly allows canonical disabled-language text on creates, preserves disabled entries on later full-field replacements, distinguishes omission from null and requires canonical/4096-byte validation. This substep is partial: other writers/forms/default-switch/boot integration remain.

- packages/catalogue/src/product-editor.test.ts, removed-variant suite: active variant missing-default refusal becomes success with exact Spanish customer map and the unchanged archived row. Failed reactivation still expects product.archived with the original field/id and rereads the most recent successful snapshot. Added en/es configuration makes the stored Spanish fixture an enabled-language edit; archived own-page refusal assertions are unchanged.
- Same file, old "names the missing language" case: product and variant missing-default refusals become exact successful stored/read-back Spanish maps, without inferred English. Separate nutrition/domain refusals remain unchanged.
- packages/catalogue/src/variants.test.ts: direct writer missing-default refusal becomes exact saved/read-back Spanish map. The later-malformed-name case still refuses both malformed examples; content.translation_required/language=en becomes content.translation_invalid/params={} because the first valid optional map no longer masks the malformed later one.
- packages/catalogue/src/content-translation-writes.test.ts: only product/variant normal-writer cases now accept English-only and read the exact stored customer map. Other kinds retain their current refusal until their own Task4 conversion; translated write/atomic ownership checks are unchanged.
- apps/server/src/catalogue-api.test.ts, new active/inactive variant case: new active French-only variant previously 400/content.translation_required; now 200 with exact French map/active flag read through GET. Archived-own-page case's disabled French edit still returns400, now content.translation_invalid; archived409 refusals and exact reread remain unchanged.
- apps/server/src/units-api.test.ts: create-only disabled French name/abbreviation cases previously400/content.translation_invalid; now201 with the entire exact saved unit and GET equality. Each immediately tests a PATCH of disabled French still returns400/content.translation_invalid and another GET remains exact. Other invalid shape/precision cases retain their old checks.
- packages/catalogue/src/units.operations.test.ts: create SELECT count1 becomes0 because it validates authored canonical maps without consulting enabled-language configuration. Update remains exactly1 SELECT; the former upper bound is retained more strictly. Stale comment deleted.

New cases observed RED: product/editor12FAIL/3PASS at intended missing-default, lost disabled/omitted values, invalid maps and explicit disabled clears; after implementation15PASS. Unit-create disabled text1RED at real createUnit refusal; after correction all4unit files76PASS. Initial broader5files328PASS/5FAIL identified superseded expectations/setup; corrected333PASS. Initial catalogue2213PASS/2FAIL and API310PASS/4FAIL identified the named old checks above, then corrected catalogue95files2215PASS with98.83S/97.26B/99.57F/99.35L; API2files314PASS; catalogue/servertypes, scopedlint/format/whitespacePASS. Three installed deliberate bypasses fail at exact assertions (3/1/3), source restored107PASS, candidate/parent/registration and owned groups absent.

The AST inventory is a structural multiset comparison, not fixture equivalence or semantic proof; repeated identical matcher expressions may be attributed to a later duplicate line. Use actual git diff hunks for changed locations. Full before/after expressions and current additions are in assertion-audit.json; this receipt must join Tasks1–3 inventories in the final PR. No guard/fiscal assertion changed in this substep, no default-switch or Task4 completion claim.

## Checkpoint 20261017-205625

### A682 Task4 remaining catalogue writers and direct product API: changed checks

Authority: approved A682 unit A / Spanish A, spec "Proposed behavior" points1/3 and "2026-10-17 closure", plan Task4, and plan "Identity, optional maps and expected facts". Normal saved maps may omit every default translation; blank values remove overrides; disabled stored entries survive full-field replacement and cannot be edited. This is an intermediate branch checkpoint, not Task4 or product completion.

Changed checks (current source lines; retain this inventory with earlier task inventories for the future PR's Changed test checks):

- packages/catalogue/src/options.test.ts:446,460: two former options.translation_required refusals (list / second label lacking default English) now assert exact saved French maps and the distinct unchanged label/staff values.
- packages/catalogue/src/extras.test.ts:1180: former extras.translation_required refusal now saves and rereads exact French customer text, staff name and original item product ID.
- packages/catalogue/src/sections.test.ts:241: former create/update menu_section.translation_required refusals now assert exact Spanish-only maps and reread, retaining the existing bilingual-save and empty-clear checks. The earlier creates/reads/updates case gained explicit en/es enabled configuration; its every existing expected field/value stays unchanged.
- packages/catalogue/src/include-folder.db.test.ts:77: trimmed blank Spanish override previously stored as an empty string, now absent from the exact override map. :163: former effective-default refusal now saves/rereads the exact Spanish-only override. :183: blank-all map previously persisted, now exactly no names override plus an unchanged inherited-root name read. Image, colour and folder-switch behavior remain checked.
- packages/catalogue/src/content-translation-writes.test.ts:208: normal options-list, label and extras writers previously refused English-only maps with Spanish default; now each exact saved/resolved names map is {en: "English only"}. The existing later bilingual round-trip and all disappeared-target/ownership cases remain.
- packages/catalogue/src/content-translations.test.ts:555: configured en/es/ca writes previously refused ca-only names for missing default; now all three writers save exact ca-only maps. With no saved configuration, ca remains outside each fallback enabled list: refusals now assert content.translation_invalid. A menu's explicit new Spanish value with fallback en similarly remains refused as a disabled edit; the existing section/include explicit-Spanish fallback calls remain. This separates completeness from enabled-language editing.
- apps/server/src/catalogue-api.test.ts:705: direct product create formerly400/content.translation_required for French-only; now201 and exact POST/GET customer map. The old second valid English create remains201 with a distinct staff name, since the first create now actually owns the original name.
- Same file:4028: extras create and PATCH formerly400/extras.translation_required with French fallback; now201/200 and exact Spanish-only maps, staff/kitchen names and item IDs. The fixture explicitly enables French and Spanish so this tests optional completeness rather than changing a disabled key.
- apps/server/src/catalogue-api.include-folder.test.ts:249: blank default override formerly400/menu_section.translation_required, now200 with the exact empty override object and reread. Every missing-member, role, malformed body, photo, colour and permission check remains.

Fixture-only growth, no assertion edits:

- apps/server/src/catalogue-manage-permission.test.ts:60 adds explicit Staff portion/sp unit fields; its original403/domain-permission and success assertions remain. The earlier broader run observed400 on the positive control before this addition.
- packages/catalogue/src/menu-document.test.ts four include/diff cases explicitly enable en/es/fr before editing those languages. Every existing document, hash, ordering, audience, language and before/after assertion is unchanged.
- packages/catalogue/src/content-translation-targets.test.ts and content-translation-report.test.ts restore their intended raw stored blank override values after normal saves, which now remove blanks. All existing nine-kind/ownership/order/count/activity assertions remain unchanged; these tests still exercise stored blank maps, not the new normal-editor clear behavior.

New tests: optional-editor-maps52 and direct API6. Qualified RED: writer40 failures/3 positives after correcting two new test expectations (existing include shape error code and off-folder presentation); API4 failures/2 positives after correcting new config setup204. Initial42 and API6 failures include those test mistakes and are not all claimed as behavior proof. GREEN all52/6.

Verification: final catalogue96files2267PASS, coverage98.83S/97.29B/99.57F/99.35L; server5files319PASS; unchanged media48; unchanged protected fiscal20. Source finalfocused158PASS. Six installed deliberate controls each failed counted assertions and restored: option merge10, extras5, section/menu8, include4, API shape3, restored strict completeness2. Final installed125PASS, and final33 stricter shared-write cases PASS. No guard/fiscal source or assertion change.

assertion-audit.json compares1506 matcher expressions in previously tracked changed suites against checkpoint HEAD5aeab5f0:1487 structurally retained. This is NOT fixture equivalence or semantic proof. Duplicate expressions can be matched to earlier new identical checks, attributing a removed status to a later unchanged line (for example original API1067/6438). Inspect the actual source-final.patch hunks for changed sites. New test file assertions are additional and outside that old-expression total.

Task4 still needs ordinary dashboard customer forms, free default-switch signature/callers, contributed-image switch/control and E-reserved boot callback integration. Tasks5–14 remain. No partial PR/push/finish/land/reset/A760 execution.

Final qualification: the first stronger `.names` assertion exposed a TypeScript union error for a missing target; the assertion now conditionally projects only a present target and still compares the entire exact map. Both catalogue/server typechecks and the final33-case shared-write suite passed after that test-only correction. Three retained unused public fallback arguments are explicitly consumed after lint rejected underscore names; no validation or preservation branch changed after controls. Candidate sources matched all6689 paths at final audit, including the final test-only assertion; candidate/parent/registration removed and16 recorded groups absent.

## Checkpoint 20261017-214313

### Changed test checks — A682 Task4 checkpoint, no PR yet

Authority: approved A682 design §Proposed behavior points1–3, dated UnitA/SpanishA closure (owner16:25/16:40), implementation plan Task4; the 2026-10-05 test-change ruling. No answer needed. All eventual PR notes must also include earlier Task1–4 inventories. Existing venue folders must be reset/reseeded remains the eventual PR's first line.

| File and current assertion lines                                                                              | Before                                                                                                                   | After and authority                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| packages/catalogue/src/content-languages.test.ts:126,132,135                                                  | An Active variant's incomplete map rejects a new default.                                                                | Save succeeds; exact config and untouched `{en:"Small cup"}` are checked before completing that map. Existing Active-only gap discovery and completion assertions stay. Free default choice, point3.                                                                                                                                                                                                                                          |
| packages/catalogue/src/content-languages.test.ts:317,320,324,328                                              | A section's incomplete map rejects a new default.                                                                        | Save succeeds; exact config, still-present gap and exact `{es:"Bebidas"}` row are checked. Same authority.                                                                                                                                                                                                                                                                                                                                    |
| packages/catalogue/src/content-languages.test.ts:370,373                                                      | Include gap produces content.default_missing.                                                                            | Save succeeds and its exact gap stays visible; existing include ownership/inheritance assertions stay. Same authority.                                                                                                                                                                                                                                                                                                                        |
| packages/catalogue/src/content-languages.test.ts:496,500                                                      | A fake contributed-image reporter rejects a new default.                                                                 | A real blank unit accepts first configuration without inventing either translated field; exact staff pair/maps/config checked. Real contributed images are now exercised through actual media storage and trading boot in images.test.ts and boot.test.ts, rather than the removed callback parameter. Same authority.                                                                                                                        |
| packages/catalogue/src/content-languages.test.ts:539,545,546,569,575,579                                      | Missing product or unit translation rejects new default; product config remains en.                                      | Save succeeds, config becomes fr and maps remain exactly authored. Later product completion and disabled-text retention checks stay. Same authority.                                                                                                                                                                                                                                                                                          |
| packages/catalogue/src/content-languages.test.ts:615,629; content-languages.valencian.test.ts:85              | Required-language calls used five positional arguments.                                                                  | The required array is argument3. Exact required-language refusals and rollback values are unchanged. Plan Task4 signature. These callback expressions appear changed in AST inventories despite identical expectations.                                                                                                                                                                                                                       |
| packages/catalogue/src/content-languages.concurrency.test.ts:48,49                                            | Serialized authoring followed by default choice rejects with default_missing and remains en.                             | Both fulfill; exact committed customer map stays `{en:"Bread"}` and config becomes fr. The reverse-order strict-validator refusal remains unchanged. Point3; media validation stays strict.                                                                                                                                                                                                                                                   |
| packages/catalogue/src/content-languages.valencian.test.ts:64,75,79                                           | Catalan-only text rejects Valencian default, config remains es.                                                          | Valencian default succeeds; exact saved config, unchanged Catalan/Spanish text and missing-Valencian gap checked. Required-enabled distinct Valencian refusal stays. Point3 and existing canonical code contract.                                                                                                                                                                                                                             |
| apps/dashboard/src/widgets/include-folder-form.test.ts:181,182,188,189,190,195,207,214                        | Cleared names suppressed hints, used default over inherited text, or showed staff; some checks described a refused save. | A clear reveals inherited Drinks/Bebidas; inherited language text precedes default text. Whole emitted override/image value remains exact. The test's persisted-presentation helper now drops blank override entries before resolving, matching the actual ordinary writer tested separately. New native-control assertions check empty entered value, required=false and inherited placeholder. Point1's clear/inheritance/placeholder rule. |
| apps/server/src/boot.test.ts:2974; :3004                                                                      | Real image gap rejects default with400/default_missing; Spanish venue without province requires[].                       | Actual trading boot returns204, exposes exact fr/es config and preserves exact image names over HTTP; test restores the original config. Required becomes[es], official list unchanged, under SpanishA. Request retains es to test image behavior independently of the regional requirement.                                                                                                                                                  |
| apps/dashboard/src/screens/content-languages-screen.test.ts:479 and content-languages-screen.a11y.test.ts:310 | Refused-save fake used retired content.default_missing.                                                                  | Same refusal/retry/action/location/accessibility checks use content.languages_invalid. Old code is retired throughout executable source and its registry/wording. Point3; the failure-presentation behavior is unchanged.                                                                                                                                                                                                                     |

`assertion-audit.json`: 1,688 of1,715 existing matcher expressions retained structurally; this is not a fixture-equivalence claim. Duplicate expressions can be attributed to a later identical line. `source-final.patch` is the actual edit inventory. New media/order/publication rows are new test fixtures only; existing money, VAT, permissions and fiscal assertions were not changed. The unedited protected pair passes20 tests.

Qualified first failures: image/catalogue switch fails content.default_missing; API switch400 vs204; include native placeholder empty vsDrinks; new required-array call resolves instead of refusing. New over-cap fixture initially used invalid private language codes, so that setup failure is excluded: corrected named201 codes refuse correctly, and200 succeed. Stronger snapshot setup first missed lineNo/name and later used strings for physical integer columns; corrected required fields and counts(1000thousandths,200cents) now pass media typecheck and50tests. Boot metadata response is `{image:{names}}`; an initial test read the wrong response level and was corrected without changing its expected map.

Controls: five deliberate faults caught at intended assertions, with each restoration passing: restored completeness gate, removed required-enabled check, removed200 cap, removed strict image validator, skipped blank-override normalization. Initial control wrapper required AssertionError for a directly thrown expected domain refusal; explicit resolves assertion strengthened that check. A later strict-control CLI had duplicate -t flags and ran no tests; excluded, corrected command then failed at intended assertion. Final gate control repeated after physical-fixture correction. Final installed media50/core40/boot7pass; complete source matched6690paths, own candidate/parent/registration and recorded process groups removed.

## Checkpoint 20261017-220013

### Changed test checks: A682 Task5 gap foundation (no PR yet)

Authority: approved A682 design “Proposed behavior” point2 and plan Task5. Unit staff identity follows closed unitA (16:25) and plan Tasks2/5. No new guard/fiscal/permission/money/drawer assertion change. The final whole-feature PR must carry this inventory with every earlier firing’s inventory.

The structural matcher inventory preserves 304 of 337 old expressions verbatim. This is not fixture equivalence; repeated identical matchers may be assigned another occurrence. The actual diff in source-final.patch is authoritative.

#### Exact assertion inventory

##### packages/catalogue/src/content-languages.test.ts

Absent maps now gap; unmatched roots are excluded while the real root remains included; root and inclusion gaps are both retained.

Before `packages/catalogue/src/content-languages.test.ts:210`:

```ts
expect(esGaps).not.toContainEqual({ kind: "product", id: plain.id });
```

Before `packages/catalogue/src/content-languages.test.ts:211`:

```ts
expect(esGaps).not.toContainEqual({ kind: "variant", id: v.id });
```

Before `packages/catalogue/src/content-languages.test.ts:259`:

```ts
expect(gaps).not.toContainEqual({ kind: "option_list", id: plain });
```

Before `packages/catalogue/src/content-languages.test.ts:260`:

```ts
expect(gaps).not.toContainEqual({ kind: "option_label", id: plainLabel });
```

Before `packages/catalogue/src/content-languages.test.ts:282`:

```ts
expect(gaps).not.toContainEqual({ kind: "extra_list", id: plain });
```

Before `packages/catalogue/src/content-languages.test.ts:283`:

```ts
expect(gaps).not.toContainEqual({ kind: "extra_list", id: blank });
```

Before `packages/catalogue/src/content-languages.test.ts:313`:

```ts
expect(gaps).not.toContainEqual({ kind: "menu_section", id: none });
```

Before `packages/catalogue/src/content-languages.test.ts:315`:

```ts
expect(gaps).toContainEqual({ kind: "menu_section", id: root });
```

Before `packages/catalogue/src/content-languages.test.ts:366`:

```ts
expect(await listContentTranslationGaps(tx, "es")).toEqual([{ kind: "menu_include", id: member }]);
```

Before `packages/catalogue/src/content-languages.test.ts:377`:

```ts
expect(await listContentTranslationGaps(tx, "es")).toEqual([{ kind: "menu_include", id: member }]);
```

Before `packages/catalogue/src/content-languages.test.ts:399`:

```ts
expect(await listContentTranslationGaps(tx, "es")).toEqual([{ kind: "menu_include", id: member }]);
```

Before `packages/catalogue/src/content-languages.test.ts:441`:

```ts
expect(await listContentTranslationGaps(tx, "en")).toEqual([]);
```

After `packages/catalogue/src/content-languages.test.ts:215`:

```ts
expect(esGaps).toContainEqual({ kind: "product", id: plain.id });
```

After `packages/catalogue/src/content-languages.test.ts:217`:

```ts
expect(esGaps).toContainEqual({ kind: "variant", id: v.id, productId: partial.id });
```

After `packages/catalogue/src/content-languages.test.ts:263`:

```ts
expect(gaps).toContainEqual({ kind: "option_list", id: plain });
```

After `packages/catalogue/src/content-languages.test.ts:264`:

```ts
expect(gaps).toContainEqual({ kind: "option_label", id: plainLabel });
```

After `packages/catalogue/src/content-languages.test.ts:284`:

```ts
expect(gaps).toContainEqual({ kind: "extra_list", id: plain });
```

After `packages/catalogue/src/content-languages.test.ts:285`:

```ts
expect(gaps).toContainEqual({ kind: "extra_list", id: blank });
```

After `packages/catalogue/src/content-languages.test.ts:314`:

```ts
expect(gaps).toContainEqual({ kind: "menu_section", id: details!.rootSectionId });
```

After `packages/catalogue/src/content-languages.test.ts:316`:

```ts
expect(gaps).toContainEqual({ kind: "menu_section", id: none });
```

After `packages/catalogue/src/content-languages.test.ts:318`:

```ts
expect(gaps).not.toContainEqual({ kind: "menu_section", id: root });
```

After `packages/catalogue/src/content-languages.test.ts:369`:

```ts
expect(await listContentTranslationGaps(tx, "es")).toEqual([
  { kind: "menu_section", id: drinksRoot },
  { kind: "menu_include", id: member },
]);
```

After `packages/catalogue/src/content-languages.test.ts:373`:

```ts
expect(await listContentTranslationGaps(tx, "en")).toEqual([
  { kind: "menu_section", id: drinksRoot },
]);
```

After `packages/catalogue/src/content-languages.test.ts:383`:

```ts
expect(await listContentTranslationGaps(tx, "es")).toEqual([
  { kind: "menu_section", id: drinksRoot },
  { kind: "menu_include", id: member },
]);
```

After `packages/catalogue/src/content-languages.test.ts:406`:

```ts
expect(await listContentTranslationGaps(tx, "es")).toEqual([
  { kind: "menu_section", id: drinksRoot },
  { kind: "menu_include", id: member },
]);
```

##### packages/catalogue/src/content-suggestion-collect.test.ts

Absent extras and whitespace enter missing-language sets; unit labels use their own staff names. Families, categories and original live-row exclusions remain exact.

Before `packages/catalogue/src/content-suggestion-collect.test.ts:243`:

```ts
expect((await listAbsentTranslationRefs(tx)).map(suggestionRef)).toEqual(
  sortRefs([
    `product:${pa}`,
    `product:${oli}`,
    `variant:${copa}`,
    `option_list:${punt}`,
    `option_label:${poc}`,
    `menu:${barRoot}`,
    `section:${plats}`,
  ]),
);
```

Before `packages/catalogue/src/content-suggestion-collect.test.ts:377`:

```ts
expect(await missingByRef(tx)).toEqual({
  [`product:${noEn}`]: ["en"],
  [`product:${noDefault}`]: ["ca"],
  [`product:${spaces}`]: ["es"],
  [`product:${nameless}`]: ["ca", "es", "en"],
  [`product:${empty}`]: ["ca", "es", "en"],
  [`variant:${glass}`]: ["ca", "es"],
  [`option_list:${doneness}`]: ["ca", "es", "en"],
  [`option_label:${rare}`]: ["es", "en"],
  [`extra_list:${sides}`]: ["es", "en"],
  [`menu:${drinksRoot}`]: ["en"],
  [`section:${mains}`]: ["ca", "es", "en"],
  [`included_menu:${include.id}`]: ["en"],
  [`unit:${portion!.id}`]: ["en"],
});
```

Before `packages/catalogue/src/content-suggestion-collect.test.ts:412`:

```ts
expect(await missingByRef(tx)).toEqual({
  [`product:${pa}`]: ["en"],
  [`product:${oli}`]: ["en"],
});
```

Before `packages/catalogue/src/content-suggestion-collect.test.ts:417`:

```ts
expect(items.map(({ ref, existing, missing }) => ({ ref, existing, missing }))).toEqual(
  inListOrder([
    { ref: `product:${pa}`, existing: { ca: "CLIENT-CA Pa", es: "\t" }, missing: ["en"] },
    {
      ref: `product:${oli}`,
      existing: { ca: "\n", es: "CLIENT-ES Aceite" },
      missing: ["en"],
    },
  ]),
);
```

Before `packages/catalogue/src/content-suggestion-collect.test.ts:652`:

```ts
expect(await collectSuggestionItems(tx, context, new Set())).toEqual(
  inListOrder([
    expected("product", blank, `product:${blank}`, "STAFF Pa"),
    expected("product", empty, `product:${empty}`, "STAFF Oli"),
    expected("variant", glass, `product:${named}`, "STAFF Copa"),
    expected("option_list", doneness, `option_list:${doneness}`, "STAFF Punt"),
    expected("option_label", rare, `option_list:${doneness}`, "STAFF Poc"),
    expected("menu", barRoot, `menu:${barRoot}`, "STAFF Bar"),
    expected("section", mains, `menu:${lunch.rootId}`, "STAFF Plats"),
  ]),
);
```

Before `packages/catalogue/src/content-suggestion-collect.test.ts:683`:

```ts
expect(
  (await collectSuggestionItems(tx, context, new Set())).map(({ ref, missing }) => ({
    ref,
    missing,
  })),
).toEqual([{ ref: `extra_list:${sides}`, missing: ["es", "en"] }]);
```

Before `packages/catalogue/src/content-suggestion-collect.test.ts:522`:

```ts
expect(await collectSuggestionItems(tx, context, new Set())).toEqual([
  {
    ref: `product:${cana}`,
    kind: "product",
    family: `product:${cana}`,
    category: "TAP BEERS",
    staffName: "STAFF Caña",
    existing: { ca: "CLIENT-CA Canya" },
    missing: ["es", "en"],
  },
  {
    ref: `variant:${pinta}`,
    kind: "variant",
    family: `product:${cana}`,
    category: "TAP BEERS",
    staffName: "STAFF Pinta",
    existing: { en: "CLIENT-EN Pint" },
    missing: ["ca", "es"],
  },
  {
    ref: `option_list:${punto}`,
    kind: "option_list",
    family: `option_list:${punto}`,
    category: null,
    staffName: "STAFF Punto",
    existing: { ca: "CLIENT-CA Punt", es: "CLIENT-ES Punto" },
    missing: ["en"],
  },
  {
    ref: `option_label:${poco}`,
    kind: "option_label",
    family: `option_list:${punto}`,
    category: null,
    staffName: "STAFF Poco",
    existing: { ca: "CLIENT-CA Poc" },
    missing: ["es", "en"],
  },
  {
    ref: `extra_list:${sides}`,
    kind: "extra_list",
    family: `extra_list:${sides}`,
    category: null,
    staffName: "STAFF Guarnición",
    existing: { ca: "CLIENT-CA Guarnició" },
    missing: ["es", "en"],
  },
  {
    ref: `menu:${drinksRoot}`,
    kind: "menu",
    family: `menu:${drinksRoot}`,
    category: null,
    staffName: "STAFF Drinks",
    existing: { ca: "CLIENT-CA Begudes", es: "CLIENT-ES Bebidas" },
    missing: ["en"],
  },
  {
    ref: `section:${plats}`,
    kind: "section",
    family: `menu:${lunch.rootId}`,
    category: null,
    staffName: "STAFF Plats",
    existing: { ca: "CLIENT-CA Plats" },
    missing: ["es", "en"],
  },
  {
    ref: `included_menu:${include.id}`,
    kind: "included_menu",
    family: `included_menu:${include.id}`,
    category: null,
    staffName: "STAFF Drinks",
    existing: { ca: "CLIENT-CA Begudes de la casa", es: "CLIENT-ES Bebidas" },
    missing: ["en"],
  },
  {
    ref: `unit:${racio!.id}`,
    kind: "unit",
    family: `unit:${racio!.id}`,
    category: null,
    staffName: "CLIENT-CA Ració",
    existing: { ca: "CLIENT-CA Ració", es: "CLIENT-ES Ración" },
    missing: ["en"],
  },
]);
```

After `packages/catalogue/src/content-suggestion-collect.test.ts:243`:

```ts
expect((await listAbsentTranslationRefs(tx)).map(suggestionRef)).toEqual(
  sortRefs([
    `product:${pa}`,
    `product:${oli}`,
    `variant:${copa}`,
    `option_list:${punt}`,
    `option_label:${poc}`,
    `extra_list:${sauces}`,
    `menu:${barRoot}`,
    `section:${plats}`,
  ]),
);
```

After `packages/catalogue/src/content-suggestion-collect.test.ts:381`:

```ts
expect(await missingByRef(tx)).toEqual({
  [`product:${noEn}`]: ["en"],
  [`product:${noDefault}`]: ["ca"],
  [`product:${spaces}`]: ["es"],
  [`product:${honey}`]: ["es"],
  [`product:${nameless}`]: ["ca", "es", "en"],
  [`product:${empty}`]: ["ca", "es", "en"],
  [`variant:${glass}`]: ["ca", "es"],
  [`option_list:${doneness}`]: ["ca", "es", "en"],
  [`option_label:${rare}`]: ["es", "en"],
  [`extra_list:${sauces}`]: ["ca", "es", "en"],
  [`extra_list:${sides}`]: ["es", "en"],
  [`menu:${drinksRoot}`]: ["en"],
  [`section:${mains}`]: ["ca", "es", "en"],
  [`included_menu:${include.id}`]: ["en"],
  [`unit:${portion!.id}`]: ["en"],
});
```

After `packages/catalogue/src/content-suggestion-collect.test.ts:418`:

```ts
expect(await missingByRef(tx)).toEqual({
  [`product:${pa}`]: ["es", "en"],
  [`product:${oli}`]: ["ca", "en"],
});
```

After `packages/catalogue/src/content-suggestion-collect.test.ts:423`:

```ts
expect(items.map(({ ref, existing, missing }) => ({ ref, existing, missing }))).toEqual(
  inListOrder([
    { ref: `product:${pa}`, existing: { ca: "CLIENT-CA Pa" }, missing: ["es", "en"] },
    {
      ref: `product:${oli}`,
      existing: { es: "CLIENT-ES Aceite" },
      missing: ["ca", "en"],
    },
  ]),
);
```

After `packages/catalogue/src/content-suggestion-collect.test.ts:658`:

```ts
expect(await collectSuggestionItems(tx, context, new Set())).toEqual(
  inListOrder([
    expected("product", blank, `product:${blank}`, "STAFF Pa"),
    expected("product", empty, `product:${empty}`, "STAFF Oli"),
    expected("variant", glass, `product:${named}`, "STAFF Copa"),
    expected("option_list", doneness, `option_list:${doneness}`, "STAFF Punt"),
    expected("option_label", rare, `option_list:${doneness}`, "STAFF Poc"),
    expected("extra_list", sauces, `extra_list:${sauces}`, "STAFF Salses"),
    expected("menu", barRoot, `menu:${barRoot}`, "STAFF Bar"),
    expected("section", mains, `menu:${lunch.rootId}`, "STAFF Plats"),
  ]),
);
```

After `packages/catalogue/src/content-suggestion-collect.test.ts:690`:

```ts
expect(
  (await collectSuggestionItems(tx, context, new Set())).map(({ ref, missing }) => ({
    ref,
    missing,
  })),
).toEqual(
  inListOrder([
    { ref: `extra_list:${sauces}`, missing: ["ca", "es", "en"] },
    { ref: `extra_list:${desserts}`, missing: ["ca", "es", "en"] },
    { ref: `extra_list:${sides}`, missing: ["es", "en"] },
  ]),
);
```

After `packages/catalogue/src/content-suggestion-collect.test.ts:528`:

```ts
expect(await collectSuggestionItems(tx, context, new Set())).toEqual([
  {
    ref: `product:${cana}`,
    kind: "product",
    family: `product:${cana}`,
    category: "TAP BEERS",
    staffName: "STAFF Caña",
    existing: { ca: "CLIENT-CA Canya" },
    missing: ["es", "en"],
  },
  {
    ref: `variant:${pinta}`,
    kind: "variant",
    family: `product:${cana}`,
    category: "TAP BEERS",
    staffName: "STAFF Pinta",
    existing: { en: "CLIENT-EN Pint" },
    missing: ["ca", "es"],
  },
  {
    ref: `option_list:${punto}`,
    kind: "option_list",
    family: `option_list:${punto}`,
    category: null,
    staffName: "STAFF Punto",
    existing: { ca: "CLIENT-CA Punt", es: "CLIENT-ES Punto" },
    missing: ["en"],
  },
  {
    ref: `option_label:${poco}`,
    kind: "option_label",
    family: `option_list:${punto}`,
    category: null,
    staffName: "STAFF Poco",
    existing: { ca: "CLIENT-CA Poc" },
    missing: ["es", "en"],
  },
  {
    ref: `extra_list:${sides}`,
    kind: "extra_list",
    family: `extra_list:${sides}`,
    category: null,
    staffName: "STAFF Guarnición",
    existing: { ca: "CLIENT-CA Guarnició" },
    missing: ["es", "en"],
  },
  {
    ref: `menu:${drinksRoot}`,
    kind: "menu",
    family: `menu:${drinksRoot}`,
    category: null,
    staffName: "STAFF Drinks",
    existing: { ca: "CLIENT-CA Begudes", es: "CLIENT-ES Bebidas" },
    missing: ["en"],
  },
  {
    ref: `section:${plats}`,
    kind: "section",
    family: `menu:${lunch.rootId}`,
    category: null,
    staffName: "STAFF Plats",
    existing: { ca: "CLIENT-CA Plats" },
    missing: ["es", "en"],
  },
  {
    ref: `included_menu:${include.id}`,
    kind: "included_menu",
    family: `included_menu:${include.id}`,
    category: null,
    staffName: "STAFF Drinks",
    existing: { ca: "CLIENT-CA Begudes de la casa", es: "CLIENT-ES Bebidas" },
    missing: ["en"],
  },
  {
    ref: `unit:${racio!.id}`,
    kind: "unit",
    family: `unit:${racio!.id}`,
    category: null,
    staffName: "Staff unit",
    existing: { ca: "CLIENT-CA Ració", es: "CLIENT-ES Ración" },
    missing: ["en"],
  },
]);
```

##### packages/catalogue/src/content-suggestion-store.test.ts

An exact whole-row assertion now admits the Spanish suggestion over tabs and refuses a correction to that missing field; original counters remain unchanged.

Before `packages/catalogue/src/content-suggestion-store.test.ts:203`:

```ts
expect(await app(suggestionRows)).toEqual(
  inOrder([
    text(venue.bread, "en", "CLIENT-EN Bread"),
    {
      itemId: venue.cheese,
      language: "es",
      text: null,
      placeholder: false,
      fix: { field: "es", wrong: "Queso", right: "Quesos" },
    },
    text(venue.cheese, "en", "CLIENT-EN Cheese"),
  ]),
);
```

After `packages/catalogue/src/content-suggestion-store.test.ts:203`:

```ts
expect(await app(suggestionRows)).toEqual(
  inOrder([
    text(venue.bread, "es", "CLIENT-ES Pan"),
    text(venue.bread, "en", "CLIENT-EN Bread"),
    text(venue.cheese, "en", "CLIENT-EN Cheese"),
  ]),
);
```

##### packages/catalogue/src/content-translation-report.test.ts

Default-language absent names and extras now appear; units use their explicit staff label; absent product parents remain in exact catalogue refs.

Before `packages/catalogue/src/content-translation-report.test.ts:127`:

```ts
expect(spanish("es")).toEqual([]);
```

Before `packages/catalogue/src/content-translation-report.test.ts:131`:

```ts
expect(catalan("ca")).toEqual([]);
```

Before `packages/catalogue/src/content-translation-report.test.ts:230`:

```ts
expect(english).toEqual([
  { kind: "product", id: parent.id, name: "STAFF Pan", reason: "absent" },
  {
    kind: "variant",
    id: medium.id,
    name: "STAFF Medium",
    reason: "absent",
    parent: { id: parent.id, name: "STAFF Pan" },
  },
  {
    kind: "variant",
    id: small!.id,
    name: "STAFF Small",
    reason: "partial",
    parent: { id: parent.id, name: "STAFF Pan" },
  },
  { kind: "option_list", id: list!.id, name: "STAFF Doneness", reason: "partial" },
  { kind: "option_list", id: spice!.id, name: "STAFF Spice", reason: "absent" },
  {
    kind: "option_label",
    id: label!.id,
    name: "STAFF Rare",
    reason: "partial",
    parent: { id: list!.id, name: "STAFF Doneness" },
  },
  { kind: "extra_list", id: extras!.id, name: "STAFF Sides", reason: "partial" },
  { kind: "menu", id: details!.root, name: "Lunch", reason: "partial", parent: menuParent },
  {
    kind: "section",
    id: section!.id,
    name: "STAFF Drinks",
    reason: "partial",
    parent: menuParent,
  },
  { kind: "unit", id: unit!.id, name: "ración", reason: "partial" },
]);
```

Before `packages/catalogue/src/content-translation-report.test.ts:307`:

```ts
expect(gaps("ca")).toEqual([
  {
    kind: "section",
    id: desserts!.id,
    name: "STAFF Desserts",
    reason: "partial",
    parent: lunchParent,
  },
  {
    kind: "included_menu",
    id: member,
    name: "STAFF Drinks",
    reason: "partial",
    parent: lunchParent,
  },
  { kind: "unit", id: unit!.id, name: "ración", reason: "partial" },
]);
```

Before `packages/catalogue/src/content-translation-report.test.ts:377`:

```ts
expect((await report(tx))("es")).toEqual([
  { kind: "unit", id: unit!.id, name: "racció", reason: "partial" },
]);
```

Before `packages/catalogue/src/content-translation-report.test.ts:396`:

```ts
expect((await report(tx))("es")).toEqual([
  { kind: "unit", id: unit!.id, name: "", reason: "partial" },
]);
```

Before `packages/catalogue/src/content-translation-report.test.ts:503`:

```ts
expect(await listContentTranslationGaps(tx, "ca")).toEqual([
  { kind: "variant", id: variant!.id, productId: product.id },
]);
```

Before `packages/catalogue/src/content-translation-report.test.ts:595`:

```ts
expect(await listContentTranslationGaps(tx, "ca")).toEqual([]);
```

After `packages/catalogue/src/content-translation-report.test.ts:127`:

```ts
expect(spanish("es")).toEqual([listed]);
```

After `packages/catalogue/src/content-translation-report.test.ts:131`:

```ts
expect(catalan("ca")).toEqual([listed]);
```

After `packages/catalogue/src/content-translation-report.test.ts:230`:

```ts
expect(english).toEqual([
  { kind: "product", id: parent.id, name: "STAFF Pan", reason: "absent" },
  {
    kind: "variant",
    id: medium.id,
    name: "STAFF Medium",
    reason: "absent",
    parent: { id: parent.id, name: "STAFF Pan" },
  },
  {
    kind: "variant",
    id: small!.id,
    name: "STAFF Small",
    reason: "partial",
    parent: { id: parent.id, name: "STAFF Pan" },
  },
  { kind: "option_list", id: list!.id, name: "STAFF Doneness", reason: "partial" },
  { kind: "option_list", id: spice!.id, name: "STAFF Spice", reason: "absent" },
  {
    kind: "option_label",
    id: label!.id,
    name: "STAFF Rare",
    reason: "partial",
    parent: { id: list!.id, name: "STAFF Doneness" },
  },
  { kind: "extra_list", id: sauces!.id, name: "STAFF Sauces", reason: "absent" },
  { kind: "extra_list", id: extras!.id, name: "STAFF Sides", reason: "partial" },
  { kind: "menu", id: details!.root, name: "Lunch", reason: "partial", parent: menuParent },
  {
    kind: "section",
    id: section!.id,
    name: "STAFF Drinks",
    reason: "partial",
    parent: menuParent,
  },
  { kind: "unit", id: unit!.id, name: "Staff unit", reason: "partial" },
]);
```

After `packages/catalogue/src/content-translation-report.test.ts:308`:

```ts
expect(gaps("ca")).toEqual([
  {
    kind: "section",
    id: desserts!.id,
    name: "STAFF Desserts",
    reason: "partial",
    parent: lunchParent,
  },
  {
    kind: "included_menu",
    id: member,
    name: "STAFF Drinks",
    reason: "partial",
    parent: lunchParent,
  },
  { kind: "unit", id: unit!.id, name: "Staff unit", reason: "partial" },
]);
```

After `packages/catalogue/src/content-translation-report.test.ts:378`:

```ts
expect((await report(tx))("es")).toEqual([
  { kind: "unit", id: unit!.id, name: "Staff unit", reason: "partial" },
]);
```

After `packages/catalogue/src/content-translation-report.test.ts:397`:

```ts
expect((await report(tx))("es")).toEqual([
  { kind: "unit", id: unit!.id, name: "Staff unit", reason: "partial" },
]);
```

After `packages/catalogue/src/content-translation-report.test.ts:436`:

```ts
expect(await listContentTranslationGaps(tx, "ca")).toEqual([{ kind: "product", id: product.id }]);
```

After `packages/catalogue/src/content-translation-report.test.ts:506`:

```ts
expect(await listContentTranslationGaps(tx, "ca")).toEqual([
  { kind: "product", id: product.id },
  { kind: "variant", id: variant!.id, productId: product.id },
]);
```

##### packages/catalogue/src/content-translation-targets.test.ts

The formerly omitted extras row is included in exact id order and total10; blank units use the staff label.

Before `packages/catalogue/src/content-translation-targets.test.ts:152`:

```ts
expect(page.rows.map(({ kind, id }) => ({ kind, id }))).toEqual([
  { kind: "product", id: ids.product },
  { kind: "variant", id: ids.variant },
  { kind: "option_list", id: ids.option_list },
  { kind: "option_label", id: ids.option_label },
  { kind: "extra_list", id: ids.extra_list },
  { kind: "menu", id: ids.menu },
  { kind: "section", id: ids.section },
  { kind: "included_menu", id: ids.included_menu },
  { kind: "unit", id: ids.unit },
]);
```

Before `packages/catalogue/src/content-translation-targets.test.ts:193`:

```ts
expect(page).toMatchObject({
  total: 9,
  next: null,
  config: { defaultLanguage: "es", languages: ["es", "ca", "en"] },
  required: ["es"],
});
```

Before `packages/catalogue/src/content-translation-targets.test.ts:495`:

```ts
expect(page.rows.find((row) => row.id === empty!.id)).toMatchObject({
  reason: "partial",
  name: "",
  defaultRequired: true,
});
```

Before `packages/catalogue/src/content-translation-targets.test.ts:500`:

```ts
expect(page.rows.find((row) => row.id === blank!.id)).toMatchObject({
  reason: "partial",
  name: "racció",
  defaultRequired: true,
});
```

After `packages/catalogue/src/content-translation-targets.test.ts:156`:

```ts
expect(page.rows.map(({ kind, id }) => ({ kind, id }))).toEqual([
  { kind: "product", id: ids.product },
  { kind: "variant", id: ids.variant },
  { kind: "option_list", id: ids.option_list },
  { kind: "option_label", id: ids.option_label },
  ...[ids.extra_list, ids.absentExtra].sort().map((id) => ({ kind: "extra_list", id })),
  { kind: "menu", id: ids.menu },
  { kind: "section", id: ids.section },
  { kind: "included_menu", id: ids.included_menu },
  { kind: "unit", id: ids.unit },
]);
```

After `packages/catalogue/src/content-translation-targets.test.ts:199`:

```ts
expect(page).toMatchObject({
  total: 10,
  next: null,
  config: { defaultLanguage: "es", languages: ["es", "ca", "en"] },
  required: ["es"],
});
```

After `packages/catalogue/src/content-translation-targets.test.ts:501`:

```ts
expect(page.rows.find((row) => row.id === empty!.id)).toMatchObject({
  reason: "partial",
  name: "Staff unit",
  defaultRequired: true,
});
```

After `packages/catalogue/src/content-translation-targets.test.ts:506`:

```ts
expect(page.rows.find((row) => row.id === blank!.id)).toMatchObject({
  reason: "partial",
  name: "Staff unit",
  defaultRequired: true,
});
```

##### packages/catalogue/src/content-translations.test.ts

Six absent default-language targets now appear on the page; every original subsequent save/snapshot assertion remains.

Before `packages/catalogue/src/content-translations.test.ts:226`:

```ts
expect(listed.some((row) => row.kind === kind && row.id === ids[kind])).toBe(false);
```

After `packages/catalogue/src/content-translations.test.ts:226`:

```ts
expect(listed.some((row) => row.kind === kind && row.id === ids[kind])).toBe(true);
```

#### Fixture additions

- content-languages.test.ts: the two variant-only fixtures gain explicit complete menu/customer maps; the first unit gains its missing French abbreviation. They retain their old exact variant and incomplete-default expectations while the new suite independently checks every blank-map kind.
- content-languages.valencian.test.ts: the existing complete-name fixture gains explicit Catalan/Valencian abbreviation entries so its no-gap expectation covers both required-to-count unit fields. Saved names remain exactly asserted.
- report/targets/collector fixtures retain the formerly ignored extras ids solely to include those rows in exact expectations. No row or original unrelated check is removed.

#### Qualification

gaps-red.log contains early fixture errors (missing catalogue id, invalid 200-language setup), which do not qualify as behavioral RED. gaps-red-qualified.log has nine assertion failures and three absent-count-API errors. The latter are additionally qualified by installed count-empty-join mutation (3 assertion failures). collector-trim-red.log has three assertion failures before .trim() change. The first full package run exposes six superseded default-page-omission checks plus an interim incorrectly expected dropped counter; corrected checks retain full saves/counters. types-first.log exposed physical money-fixture typing, Vitest tuple arity and execute generic shape; all corrected before passing types.

Eight installed faults each cause intended assertion failures; all restoration commands pass. Full final source catalogue98files2286PASS, coverage98.82S97.31B99.57F99.35L; source server3files364PASS and protected2files20PASS. Installed final8files196PASS. All6692source paths equal before candidate cleanup; later formatting/docs-only edits are outside that byte-equivalence claim.

## Checkpoint 20261017-2245

### A682 bounded reads checkpoint — 2026-10-17

No pre-checkpoint test assertion or fixture was changed. The new files are `packages/catalogue/src/content-translation-cells.test.ts` and `content-translation-pages.test.ts`. Keep all earlier A682 changed-check inventories for the final PR.

New behavior exercised: all nine identities/owners and include inheritance; distinct unit staff fields; archived direct cells and missing/disabled review facts; 100-cell bound; 50-row/8-column bounds and advancing 51-row lookahead; 200 enabled languages with only selected/default field values leaving SQLite; independent Missing in filters; projected-text/staff/parent search; complete waiting-fix discovery; cursor filter/shape/config/required-language changes and JSON key order. Unknown cell keys cannot use inherited object properties in place of the declared field.

Qualified RED: 13 assertion failures against the direct-cell scaffold; 21 page assertion failures against its scaffold (the 200-language test had a separate fixture error and is excluded from that count); one removed-language configuration assertion; one inherited-field/unknown-key assertion. Each later passed. The initial missing-module suite reported no tests and is not a RED behavioral receipt. Replacing invented q-code fixture languages with actual contentLanguageChoices fixed setup; the installed projection-leak control subsequently failed its intended name-150 assertion. The first typecheck failed because a union argument had not been narrowed by the runtime validator and an interface intersection lacked SQLite's record constraint; private validation now accepts unknown and the SQL DTO uses a literal record. Later checks pass; initial failed commands are retained.

Eight installed faults caught intended assertion failures (one each): missing-in limited to viewed languages, missing 51st-row lookahead, ignored cursor configuration, staff name replacing unit staff abbreviation, complete maps leaked from SQL, omitted discovery liveness, included menus without overrides listed twice, omitted unknown-cell-key check. Every restoration passed. Installed final four suites: 79 passed. See control-results.json and individual logs.

Source and installed candidate matched all 6696 selected cached/untracked source paths before cleanup. After cleanup, the source tests gained explicit variant/options parent-search assertions and a literal include-owner expectation, plus a narrower search-test title; production code did not change. Source final four suites: 79 passed. Final formatting/documentation edits are outside the earlier full-tree equality claim. Candidate/parent/registration and recorded process groups removed; candidate-cleanup.json records checks.

Temporary internal integration names: TranslationItemPage/listTranslationItems keep the still-unmigrated single-language editor working in this unpublished one-PR branch. Task7 must switch to the planned TranslationPage/listTranslationTargets names and retire the old HTTP route. No compatibility route was added. Task5’s read behavior is qualified; naming/consumer integration and Tasks6–14 remain. Task4’s E boot callback cleanup and Task12’s G snapshot functions remain reserved. No reset, A760 execution, partial PR/push or final review was performed.

## Checkpoint 20261017-233122

### A682 Task6 baseline foundation — changed checks

No pre-checkpoint test assertion or fixture changed in this unit. The only test path is the new `packages/catalogue/src/content-translation-baseline.test.ts`. All prior A682 inventories remain required for the eventual one-PR Changed test checks section.

New tests cover strict cell/ref/field/config/owner/structure parsing, null/string preservation, distinct canonical language sets at 200/201, structural comparison, default and inherited-root peer projection including clears, unit field independence and real database rereads in either batch order. This does not establish atomic writes or retry admission in the route: the current single-language implementation is still awaiting integration.

Initial missing-module run had no Tests count and is NOT behavioral evidence. The first incremental parser/projection then failed 47 assertions, including missing config canonicalization, missing domain refusals, order-sensitive comparison and stale root/default projection. A later private/regional-tag 200-language fixture was invalid because contentLanguageCode normalizes to base-language identity; first focused run 195 PASS/1 FAIL and first full package 2375 PASS/1 FAIL. It was corrected to distinct supported contentLanguageChoices codes, after following the actual shared function. This fixture mistake is not a product RED claim. Initial scoped lint found two unused test destructures; corrected without changing assertions.

Corrected full package: 101 files/2376 PASS, coverage98.86S/97.42B/99.59F/99.37L, exit0. One further shape-compatible wrong-owner-kind test was added after that coverage run; final focused fivefiles197 PASS and installed baseline50 PASS cover it. No production source changed after the full coverage run. Final catalogue types/scoped lint/format/whitespace pass. Protected fiscal20/errorguards36 PASS; those test sources are unedited by this unit.

Eight independent installed omissions caught intended assertion failures: language match1, field match1, owner kind1, activity validation1, default-clear projection1, inherited-selected projection2, inherited-default projection2, serialization-order comparison1. Each restoration passed; final installed baseline50 PASS. Exact failures, messages, commands and exit statuses are in control-results.json and per-control JSON/logs. Candidate equality6698 paths, with only later docs/backlog.md prose outside final equality; cleanup.json records own resources removed. Tests exercise parser/projection, not the currently unwired atomic save orchestration.

Temporary TranslationCellEdit remains beside legacy TranslationEdit by the ledger ruling; replace/retire old names and route together during Task6/7 in this unpublished branch. Task6 itself and all remaining A682 delivery work remain incomplete.

## Checkpoint 20261018-000923

### A682 Task6 atomic save checkpoint

No existing test assertion or fixture changed in this unit (git diff --name-only HEAD contains no tracked test). Added content-translation-save.test.ts: final 53 cases. Retain all prior A682 Changed test checks inventories for the eventual one PR, including the explicitly approved RESETS entry. The PR must begin by requiring existing venue folders to be reset/reseeded. No reset or A760 execution occurred.

New internal saveTranslationCells and writeTranslationMaps are qualified through real useVenueDb transactions for all nine kinds, final replacements/null clears, grouped unit fields, disabled and unsubmitted languages, inherited root/default peers in either order, complete retry identity, scoped name-suggestion cleanup, structural/configuration/availability races, and byte/cell limits. Temporary old API/function/error-field contracts remain until Task7 integration in the same unpublished branch; this checkpoint is NOT Task6-complete or an HTTP/editor behavior claim.

Initial main-checkout write was an accidental omitted cwd. Its run failed at missing module/noTests; the new file was moved verbatim into the registered feature before qualified runs and main clean verified. Initial new fixture lacked variant catalogueId; the next run reached the missing new API (positive cases TypeError, refusal cases assertion mismatches). Option label has no active column; that fixture was corrected to its owning option list. New 101-cell setup first requested 101 through a capped-100 direct read; split setup reads corrected it without changing the 101-save refusal assertion. Later root-ownership scenario first selected an include while changing its PARENT menu's root; the intended saved-menu ownership fact belongs to the menu target, now explicitly selected. That mistaken new probe is excluded from product RED evidence. No production change followed those setup corrections.

Final source five-file focused run: 229 PASS, including 53 new save cases. Full catalogue before the last 11 test additions: 102 files / 2419 PASS; production source unchanged since that run, coverage 98.80 statements / 97.37 branches / 99.59 functions / 99.34 lines. Catalogue/server/dashboard types, scoped lint, source formatting and whitespace passed. Error guards 36 PASS; unedited protected fiscal 20 PASS. Final new test edits and documentation are outside the earlier complete installed-tree equivalence claim.

Installed candidate with dependencies: baseline44 PASS; eleven independent faults each caused intended assertion failures (12,2,19,1,2,2,1,1,1,1,10), each restored44 PASS. Faults: omit clear, cellwise mixed retry, unwired peer projection, abbreviation deleting name suggestions, omitted cleanup, omitted unit abbreviation, oversized retry, 101-cell admission, omitted whole-batch prevalidation, rewriting exact retry, dropping stored maps. control-results.json retains exact test names/messages. Before the later safety tests, all6699 source/candidate paths matched; final candidate differed only in this new test file, with production source still equal. Candidate/parent/registration and all recorded control process groups removed; cleanup.json is the receipt.

Remaining: old single-language safety-case/contract retirement under Task6/7, exact error types and catalogue exports; bounded HTTP/passive clients/count screen/live dependencies; suggestions/corrections, retained drafts and editor; future presentation and visual acceptance; E boot cleanup; final one Claude review, normal push hook/current-head CI and H11 locked authorised landing/main install/cleanup/H12. checkedCells currently uses legacy writers only to validate kinds: replace that dependency with TRANSLATION_GAP_KINDS before deleting the old writer registry. No partial PR, readiness, finish/land, second item or STOP.

## Checkpoint 20261018-005322-contracts

### A682 — Changed test checks (no PR yet)

Original campaign start2026-10-17 16:00 unchanged. Authority: approved A682 design closure and plan Tasks6–7; all earlier checkpoint inventories remain required for the eventual single PR.

- `packages/catalogue/src/content-translations.test.ts:243` — Returned selectedText becomes text, with explicit en/name identity. The aggregate snapshots still require every unrelated row/column to match. Plan Task6 and cell DTO contract.
- `packages/catalogue/src/content-translations.test.ts:274` — The missing-default refusal becomes malformed-final-map refusal: exact variant/en/name and content.translation_invalid, with full rollback. Missing default is intentionally optional under design points1/3 and Task6.
- `packages/catalogue/src/content-translations.test.ts:469` — Changing an edit language without its token now refuses content.translation_batch_invalid instead of old route-language staleness. The untouched-language null check remains. Plan per-cell token identity.
- `packages/catalogue/src/content-translations.test.ts:484` — defaultText companion is replaced by a separate es/name cell; both canonical outputs, exact retry and zero updates are checked. The retired companion key is still rejected in all three old contexts. Task6.
- `packages/catalogue/src/content-translations.test.ts:538` — Root en/es are explicit peer cells. selectedText becomes text; retired defaultRequired is replaced by exact own/default/effective-default facts and full retry/map checks. Root/include order remains parameterized. Task6.
- `packages/catalogue/src/content-translations.test.ts:709` — Exact execute count2 becomes4: settings, bounded selected-cell query, full replacement-map query, final cell reread. The count/id values and untouched product checks remain. Task6 ledger ruling retains two separately bounded reads.
- `packages/catalogue/src/content-translations.test.ts:884` — Malformed stored unit map now reports field:name rather than text and content.translation_invalid rather than the legacy language-invalid cause. Exact cause params, target/language and full rollback stay. Task1 optional validator and Task6 error contract.
- `packages/catalogue/src/content-translations.test.ts:908` — Nine missing-default refusal cases now require exact successful English cell and blank default, then normalize only the permitted changed map before comparing the entire before/after database snapshot. Task6 optional-text contract; raw include blank is retained.
- `apps/server/src/content-translations-api.test.ts:264` — Route/cell fixtures move from /:language and row tokens to base path, projected cells and explicit language/field. Whole response comparisons, unchanged columns, retries and menu revision remain. Task7.
- `apps/server/src/content-translations-api.test.ts:322` — Missing-default refusal becomes malformed-map refusal with exact en/name/content.translation_invalid; repair the malformed stored map before retry. Null text now has a successful multilingual-clear case; malformed textNull input becomes omitted-text refusal. UTF8 checks now cover name and abbreviation instead of text/defaultText. Task6/7 explicit-cell contract.
- `apps/server/src/content-translations-api.test.ts:615` — The retired language path is replaced by query/explicit edit language validation. Noncanonical/disabled GET returns content.translation_invalid; mismatched/noncanonical PUT returns content.translation_batch_invalid. Disabled cells read unavailable and saving returns exact409 cell identity. Task7.
- `apps/server/src/catalogue-api.test.ts:906` — Detailed product-filtered gap arrays become count-only output. Capture counts after menu creation, assert exact deltas es+0/ca+1/en+1 for the newly stored product and preserve the original id check through the database. Shared suite rows make absolute totals inappropriate; initial assumed1/2/2 values failed and are retained in logs. Task7 count endpoint.
- `apps/dashboard/src/api/live-queries.test.ts:442` — Exact dependency fixture gains menu_details, retaining every former resource in order; existing matcher expression is unchanged. Added behavioral invalidation rows cover new cell reads, target waiting fixes and suggestion freshness. Task7 explicitly requires these dependencies.
- `apps/dashboard/src/screens/content-languages-screen.test.ts:852` — Gap arrays become literal counts with the same cardinality. Every existing matcher expression remains structurally identical; current screen/counts/live/recovery behavior remains asserted. a11y stub converts its authored gap fixtures to counts while retaining the separate target data. Task7.

Fixture/producer-only changes: content-suggestions-api.test.ts uses the new URL and cell token plus a same-origin absolute URL; content-suggestion-store.test.ts and menu-publication.test.ts retain all matcher expressions while acquiring cell tokens. content-suggestion-store.list.test.ts now supplies explicit es/ca name cells and keeps all expected suggestion rows/counts/rollback/publication facts; its one changed printed matcher embeds the new three-argument call inside expect(...), with the same rejects.toThrow text. content-translation-save.test.ts changes only the imported/called function name to canonical saveContentTranslations; three printed matcher expressions include that name, and expected values stay unchanged. No fiscal, money, VAT, login refusal, permission or drawer expected value changed. No scripts/root guard edited.

AST inventory: assertion-audit.json retains2208of2251 earlier printed matcher expressions, current2297. This is structural comparison, not fixture equivalence, and it does not count it.each table entries separately. Exact before/after expressions and line numbers are in that JSON; source-final.patch carries the complete diff. Shared SQL producer, HTTP decoder and unrelated code should be reviewed from the actual patch.

Verification qualifications: initial54 HTTP cases failed404; expanded81failed/9passed established missing new routes, old-route retirement and count output. Initial configured-origin case used mismatched required rules and got409; corrected rules gave the qualified wrong-origin200vs403 failure. Count-screen initial failure was an old gaps.length TypeError, and new client/cell dependency failures included absent interfaces; they are not asserted as deletion-control evidence. Existing count/suggestion missing-menu invalidation cases failed at the intended2reads-vs1 assertion; final disposable controls supply independent assertion receipts for screen counts/client encoding/new guards. Full catalogue first6failed/2424passed exposed three missed old fixture callers; their subsequent143PASS and final2430PASS/allbars qualify the correction.

LOOK: eight current EN/ES/light/dark/390/1280 table images inspected and copied to look/. Counts and language actions are visible. Regional note text remains clipped; Task10 explicitly owns its wrapping and final visual acceptance. No complete-editor or visual-completion claim.

Still unfinished: legacy writer/cleanup/type retirement; dashboard page/save contract and new model/dialog; automatic suggestions/fixes; future snapshot presentation; reserved boot cleanup and managementOrigin forwarding; final owner/product documentation and complete-branch verification/review/finish/land. No partial PR or reset/A760 execution.

## Checkpoint 20261018-014732-legacy

### A682 — low-level writer retirement and correction evidence

BASE: e260405245d852f0c37897526b04b0b4a20a779a. This is a checkpoint within the single A682 item, not a feature-ready PR.
Authority: approved A682 plan Tasks6/8 (lines449–460,474–485), Atomic save steps1–6 (300–309), correction evidence/freshness (340–346), and the owner's 2026-10-05 changed-check permission. Keep this inventory and every earlier A682 inventory for the eventual PR's Changed test checks section.

| Current test location                                            | Before                                                                                                                       | After / retained assertions                                                                                                                                                                                                                                   |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| packages/catalogue/src/content-translation-writes.test.ts:247    | Disappeared target, wrong product/variant kind and inactive option owner refused through the retired patch writers.          | The final-map writer refuses the same cases with the same content.translation_invalid code; missing-target cases additionally compare the complete stored aggregates.                                                                                         |
| packages/catalogue/src/content-translation-writes.test.ts:288    | Archived product/variant and archived-parent writes merge a new English customer name and preserve every other column.       | Exact same resulting maps and complete before/after aggregate comparison; the caller supplies the final map.                                                                                                                                                  |
| packages/catalogue/src/content-translation-writes.test.ts:318    | Six low-level patch writers add English with no configuration/read query and leave every other language/aggregate unchanged. | Final-map writer receives explicit full maps; unchanged zero-read assertions, exact English checks and complete other-column/row comparisons. This tests final-map writing, not orchestration's merging; the existing cell-save suite still tests that merge. |
| packages/catalogue/src/content-translation-writes.test.ts:377    | Missing default companion refuses, and adding it explicitly saves both languages.                                            | Optional final map containing English alone succeeds and exactly replaces only the name map; complete aggregates compared. No completeness refusal remains.                                                                                                   |
| packages/catalogue/src/content-translation-writes.test.ts:410    | Explicit default companion saves en/es/blank-ca under the old patch API.                                                     | Exact en/es replacement excludes the cleared ca key, then an empty map clears the final translation. Required staff identity is unchanged.                                                                                                                    |
| packages/catalogue/src/content-translation-writes.test.ts:440    | Menu/section/included-menu missing effective default refuses, then en/es saves.                                              | English alone succeeds under optional completeness. Same include colour/image/folder state, zero-read checks and every remaining section/member row comparison stay.                                                                                          |
| packages/catalogue/src/content-suggestion-store.test.ts:72       | Collected names carry the old item/language token.                                                                           | Same job/time/map checks; expected is the exact name-cell token from resolveTranslationCells.                                                                                                                                                                 |
| packages/catalogue/src/content-suggestion-store.list.test.ts:102 | Cheese's wrong='Formatge' note reports stale:false despite saved text='CLIENT-CA Formatge'.                                  | Exact same note remains, now stale:true because it has no matching evidence. All other suggestion values and run counts stay.                                                                                                                                 |
| packages/catalogue/src/content-suggestion-store.list.test.ts:243 | Starting a new run deletes the correction note when Cheese's remaining gap is filled.                                        | Same other five rows, plus that retained complete-row correction note.                                                                                                                                                                                        |
| packages/catalogue/src/content-suggestion-store.list.test.ts:430 | Hand-built comparison token lacks field/structure.                                                                           | Fixture gains name field and complete product structure; every existing configuration-ignore, text/owner/identity and malformed-token assertion stays.                                                                                                        |

New behavior cases: three writer identity/rollback cases and twenty-one correction evidence/freshness/pruning cases. Existing monetary, fiscal, login, permission and drawer expected values were not changed. No root guard was changed in this unit. No old shared fixture was edited; the new evidence suite builds extra list/label, unit and include fixtures locally.

assertion-audit.json retains every printed old/new matcher expression and its source line. It compares source expression multisets, not fixture equivalence; it.each data rows are not counted separately. Of136 earlier printed expressions,122 are unchanged; current166 includes28 in the new evidence suite. The actual source-final.patch is the authoritative hunk/fixture inventory.

Qualification:

- writer-identity-red.log: three intended resolved-instead-of-refused failures; writer-identity-green.log:3PASS. Migrated writers36PASS and retired-writers five suites205PASS.
- evidence-red.log:19FAIL/1PASS. The initial changed-owner case failed the missing-evidence prerequisite; after evidence implementation it hit the product parent-immutability trigger. The fixture now uses a genuinely mutable option-label owner, without changing that trigger or a product invariant. evidence-green.log:20PASS. Do not count the trigger error as a product RED proof.
- wrong-recheck-red.log: current mismatch remained stale:false; final focused eight suites273PASS.
- Full catalogue103files2454PASS; coverage98.77 statements/97.17 branches/99.50 functions/99.27 lines. Server suggestion API/runner/fake-Cloud139PASS. Unchanged protected fiscal20PASS. Root error/alert36PASS. Catalogue/server/dashboard types, scoped ESLint, source Prettier and whitespace checks pass.
- Six installed faults caught3/3/1/1/1/1 intended assertion failures; all restored selections passed. Two full installed suite baselines57PASS. The first control wrapper rejected Vitest JSON's Error-formatted resolved-promise assertion because it demanded the text AssertionError; its retained report proves3 intended assertions. The resumed wrapper accepted that exact assertion form, restored the candidate and continued without rerunning the qualified fault.
- Initial typecheck found an incorrect type import and the local registry's interface/intersection shape, then an unused test import; final literal registry shapes and correct type imports pass all three package typechecks. No shared errors implementation was changed.

Remaining: Task8 all-language suggestion query/DTO/HTTP paging and waiting-fix counts; Tasks9–14 model/dialog/Use fix/presentation/acceptance; remaining public page/edit/query/save naming migration and E-reserved boot cleanup. No Task6/7/8-done, Use-fix UI, full-server/dashboard coverage, visual acceptance or feature readiness claim. No reset/A760, partial PR, final review, push or landing occurred.

## Checkpoint 20261018-023244-paging

### A682 Task8 suggestion paging: Changed test checks (FYI, no answer needed)

Authority: approved plan `docs/superpowers/plans/2026-10-17-a682-translations.md`, “Suggestions and draft ownership” and Task8: all-language suggestion queries, fresh current cell tokens, configuration-bound continuation and independent waitingFixes. Tasks7/10 consumer adaptation was brought forward to keep the existing dashboard reader consistent with this DTO. This remains one unpublished A682 branch; no partial PR or feature-ready claim.

- `apps/dashboard/src/api/client-routes.test.ts:252,253,262`: the two exact response checks and exact request list replace a single-language URL with no-query first read and an encoded after/configuration/fixesOnly query. Job start, method, body, response and discard checks remain.
- `apps/dashboard/src/widgets/content-translations-dialog.drafts.test.ts:226,230,929,941,1096`: later-read and no-further-read checks now assert the query object and configuration, or inspect query.after. All field/draft/save/late-reply assertions remain. At746 and819, the French-opening request check now awaits a flag set by the newly installed reader after its actual read resolves, before holding its answer; matching an old no-argument call would weaken that ordering. At1106, the old wrong-language fixture is now a configuration disabling the viewed language; its no-fill and repeated-cursor checks remain.
- `apps/dashboard/src/widgets/content-translations-dialog.test.ts:242` and `content-translations-dialog.translate-all.test.ts:148,406`: suggestion reads no longer take a page language; passive-client routing, read counts and late-result checks remain.
- `apps/server/src/content-suggestions-api.test.ts:249,264,313,339,426`: same service/origin/run/opening/suggestion values now come from the no-language helper. Exact complete replies replace page.language with config/required/configuration/waitingFixes and add each suggestion's cell/current expected token. Query-refusal table replaces “missing language” with the removed language parameter; disabled-language filter now receives content.translation_invalid. Permission, primary, job, Cloud refusal, deletion and save assertions remain.
- `packages/catalogue/src/content-suggestion-store.list.test.ts:98,102,128,168`: config replaces selected-language echo; exact suggestion/name/language assertions now include all three enabled languages and all prior notes/fixes. The removed language-filter input is invalid rather than a disabled-language request. Existing stale, cleanup, retry, rollback and deletion assertions remain. Cursor helper carries the configuration with after.

Fixture-only adaptations: four typed suggestion factories add cell/expected; mock suggestion replies in dialog, unit language-screen and dashboard application tests gain configuration metadata. Paging fakes accept query.after; deferred reads keep their held operation and ownership checks. `apps/dashboard/src/api/live-queries.test.ts` invokes the no-language method with []; every dependency assertion remains. `apps/server/src/boot.clock-wiring.test.ts:198` reads the no-language URL; every timing/runner assertion remains. No guard, monetary, VAT, permission, login, drawer or protected fiscal expected value changes.

The following printed TypeScript matcher inventory is exhaustive for expression changes, not fixture equivalence or expanded it.each rows. It records 2620 original expressions, 2598 retained identically, 22 replaced, 68 added (2666 current). Runtime assertions are qualified by the named test logs; source equality alone does not establish behavior. Every earlier A682 inventory must accompany this one in the eventual single PR's Changed test checks section.

#### apps/dashboard/src/api/client-routes.test.ts

Before:

Line 249:

```ts
expect(api.getContentSuggestions("ca-ES-valencia")).resolves.toEqual(read);
```

Line 250:

```ts
expect(api.getContentSuggestions("ca-ES-valencia", "s 1&x")).resolves.toEqual(read);
```

Line 253:

```ts
expect(callsOf(fetchImpl)).toEqual([
  ["/management-api/content-suggestions/jobs", "POST", {}],
  ["/management-api/content-suggestions?language=ca-ES-valencia", "GET", undefined],
  ["/management-api/content-suggestions?language=ca-ES-valencia&after=s+1%26x", "GET", undefined],
  ["/management-api/content-suggestions/a%2Fb%20c", "DELETE", undefined],
]);
```

After (includes added checks in the same file):

Line 252:

```ts
expect(api.getContentSuggestions()).resolves.toEqual(read);
```

Line 253:

```ts
expect(
  api.getContentSuggestions({
    after: "s 1&x",
    configuration: "configuration &1",
    fixesOnly: true,
  }),
).resolves.toEqual(read);
```

Line 262:

```ts
expect(callsOf(fetchImpl)).toEqual([
  ["/management-api/content-suggestions/jobs", "POST", {}],
  ["/management-api/content-suggestions", "GET", undefined],
  [
    "/management-api/content-suggestions?after=s+1%26x&configuration=configuration+%261&fixesOnly=1",
    "GET",
    undefined,
  ],
  ["/management-api/content-suggestions/a%2Fb%20c", "DELETE", undefined],
]);
```

#### apps/dashboard/src/widgets/content-translations-dialog.drafts.test.ts

Before:

Line 219:

```ts
expect(api.getContentSuggestions).toHaveBeenCalledWith("es", "1");
```

Line 220:

```ts
expect(api.getContentSuggestions).toHaveBeenCalledWith("es", "2");
```

Line 732:

```ts
expect(api.getContentSuggestions).toHaveBeenCalledWith("fr");
```

Line 803:

```ts
expect(api.getContentSuggestions).toHaveBeenCalledWith("fr");
```

Line 911:

```ts
expect(api.getContentSuggestions).toHaveBeenCalledWith("es", "1");
```

Line 919:

```ts
expect(api.getContentSuggestions).not.toHaveBeenCalledWith("es", "2");
```

Line 1069:

```ts
expect(
  api.getContentSuggestions.mock.calls.slice(reads).some(([, after]) => after !== undefined),
).toBe(true);
```

After (includes added checks in the same file):

Line 226:

```ts
expect(api.getContentSuggestions).toHaveBeenCalledWith({
  after: "1",
  configuration: "suggestion-config",
});
```

Line 230:

```ts
expect(api.getContentSuggestions).toHaveBeenCalledWith({
  after: "2",
  configuration: "suggestion-config",
});
```

Line 746:

```ts
expect(reopenedRead).toBe(true);
```

Line 819:

```ts
expect(reopenedRead).toBe(true);
```

Line 929:

```ts
expect(api.getContentSuggestions).toHaveBeenCalledWith({
  after: "1",
  configuration: "suggestion-config",
});
```

Line 941:

```ts
expect(api.getContentSuggestions).not.toHaveBeenCalledWith({
  after: "2",
  configuration: "suggestion-config",
});
```

Line 1096:

```ts
expect(
  api.getContentSuggestions.mock.calls.slice(reads).some(([query]) => query?.after !== undefined),
).toBe(true);
```

Line 1555:

```ts
expect(api.getContentSuggestions).toHaveBeenCalledWith({
  after: "1",
  configuration: "original-config",
});
```

Line 1559:

```ts
expect(field(el, "one")!.value).toBe("");
```

Line 1563:

```ts
expect(bar.error).not.toBe("");
```

#### apps/dashboard/src/widgets/content-translations-dialog.test.ts

Before:

Line 224:

```ts
expect(passive.getContentSuggestions).toHaveBeenCalledWith("es");
```

After (includes added checks in the same file):

Line 242:

```ts
expect(passive.getContentSuggestions).toHaveBeenCalledWith();
```

#### apps/dashboard/src/widgets/content-translations-dialog.translate-all.test.ts

Before:

Line 145:

```ts
expect(getContentSuggestions).toHaveBeenCalledWith("es");
```

Line 403:

```ts
expect(api.getContentSuggestions).toHaveBeenCalledWith("en");
```

After (includes added checks in the same file):

Line 148:

```ts
expect(getContentSuggestions).toHaveBeenCalledWith();
```

Line 406:

```ts
expect(api.getContentSuggestions).toHaveBeenCalledWith();
```

#### apps/server/src/content-suggestions-api.test.ts

Before:

Line 248:

```ts
expect(await read(http, "en")).toMatchObject({
  service: "on",
  cloudOrigin: CLOUD,
  run: { state: "sending", opened: false },
  suggestions: [],
});
```

Line 263:

```ts
expect(await read(http, "en")).toEqual({
  language: "en",
  service: "on",
  cloudOrigin: CLOUD,
  next: null,
  run: expect.objectContaining({ state: "done", waiting: 1, opened: true }),
  suggestions: [
    {
      id: expect.any(String),
      kind: "product",
      itemId: id,
      language: "en",
      text: "EN STAFF Bread",
      placeholder: false,
      fix: null,
      stale: false,
    },
  ],
});
```

Line 307:

```ts
expect(await read(standby, "en")).toMatchObject({
  run: { state: "done", opened: false },
  suggestions: [{ text: "EN STAFF Bread" }],
});
```

Line 333:

```ts
expect(await read(mount({ connection: undefined, cloudOrigin: undefined }), "en")).toEqual({
  language: "en",
  service: "not_connected",
  cloudOrigin: null,
  run: null,
  suggestions: [],
  next: null,
});
```

Line 417:

```ts
expect(await read(http, "en")).toMatchObject({ suggestions: [] });
```

After (includes added checks in the same file):

Line 249:

```ts
expect(await read(http)).toMatchObject({
  service: "on",
  cloudOrigin: CLOUD,
  run: { state: "sending", opened: false },
  suggestions: [],
});
```

Line 264:

```ts
expect(await read(http)).toEqual({
  config: { defaultLanguage: "es", languages: ["es", "en"] },
  required: [],
  configuration: expect.any(String),
  waitingFixes: 0,
  service: "on",
  cloudOrigin: CLOUD,
  next: null,
  run: expect.objectContaining({ state: "done", waiting: 1, opened: true }),
  suggestions: [
    {
      id: expect.any(String),
      kind: "product",
      itemId: id,
      language: "en",
      text: "EN STAFF Bread",
      placeholder: false,
      fix: null,
      stale: false,
      cell: { kind: "product", id, language: "en", field: "name" },
      expected: expect.any(String),
    },
  ],
});
```

Line 313:

```ts
expect(await read(standby)).toMatchObject({
  run: { state: "done", opened: false },
  suggestions: [{ text: "EN STAFF Bread" }],
});
```

Line 339:

```ts
expect(await read(mount({ connection: undefined, cloudOrigin: undefined }))).toEqual({
  config: { defaultLanguage: "es", languages: ["es", "en"] },
  required: [],
  configuration: expect.any(String),
  waitingFixes: 0,
  service: "not_connected",
  cloudOrigin: null,
  run: null,
  suggestions: [],
  next: null,
});
```

Line 426:

```ts
expect(await read(http)).toMatchObject({ suggestions: [] });
```

Line 432:

```ts
expect(response.status).toBe(200);
```

Line 433:

```ts
expect(await response.json()).toMatchObject({
  config: { defaultLanguage: "es", languages: ["es", "en"] },
  required: [],
  configuration: expect.any(String),
  waitingFixes: 0,
  suggestions: [],
});
```

Line 461:

```ts
expect(response.status).toBe(200);
```

Line 463:

```ts
expect(first.suggestions).toEqual([]);
```

Line 464:

```ts
expect(first.next).toBe("a-099");
```

Line 465:

```ts
expect(first.waitingFixes).toBe(1);
```

Line 472:

```ts
expect(next.status).toBe(200);
```

Line 473:

```ts
expect(await next.json()).toMatchObject({
  next: null,
  waitingFixes: 1,
  suggestions: [{ id: note!.id, cell: null, expected: null, placeholder: true }],
});
```

Line 482:

```ts
expect(
  await suite.db.select().from(contentSuggestions).where(eq(contentSuggestions.id, note!.id)),
).toHaveLength(1);
```

#### packages/catalogue/src/content-suggestion-store.list.test.ts

Before:

Line 98:

```ts
expect(listed.language).toBe("es");
```

Line 102:

```ts
expect(summary(listed.suggestions)).toEqual(
  inOrder([
    {
      itemId: venue.bread,
      language: null,
      text: null,
      placeholder: false,
      fix: { field: "internal", wrong: "Bread", right: "Bred" },
      stale: false,
    },
    named(venue.bread, "es", "CLIENT-ES Pan"),
    named(venue.wine, "ca", "CLIENT-CA Vi"),
    named(venue.wine, "es", "CLIENT-ES Vino"),
    {
      itemId: venue.cheese,
      language: "ca",
      text: null,
      placeholder: false,
      fix: { field: "ca", wrong: "Formatge", right: "Formatges" },
      stale: true,
    },
  ]),
);
```

Line 125:

```ts
expect((await page("ca")).suggestions.map((view) => view.language).sort()).toEqual([
  "ca",
  "ca",
  null,
]);
```

Line 160:

```ts
expect(page("fr")).rejects.toMatchObject({ code: "content.languages_invalid" });
```

After (includes added checks in the same file):

Line 98:

```ts
expect(listed.config).toEqual({ defaultLanguage: "ca", languages: ["ca", "es", "en"] });
```

Line 102:

```ts
expect(summary(listed.suggestions)).toEqual(
  inOrder([
    {
      itemId: venue.bread,
      language: null,
      text: null,
      placeholder: false,
      fix: { field: "internal", wrong: "Bread", right: "Bred" },
      stale: false,
    },
    named(venue.bread, "es", "CLIENT-ES Pan"),
    named(venue.bread, "en", "CLIENT-EN Bread"),
    named(venue.wine, "ca", "CLIENT-CA Vi"),
    named(venue.wine, "es", "CLIENT-ES Vino"),
    named(venue.wine, "en", "CLIENT-EN Wine"),
    named(venue.cheese, "en", "CLIENT-EN Cheese"),
    {
      itemId: venue.cheese,
      language: "ca",
      text: null,
      placeholder: false,
      fix: { field: "ca", wrong: "Formatge", right: "Formatges" },
      stale: true,
    },
  ]),
);
```

Line 128:

```ts
expect((await page()).suggestions.map((view) => view.language).sort()).toEqual([
  "ca",
  "ca",
  "en",
  "en",
  "en",
  "es",
  "es",
  null,
]);
```

Line 168:

```ts
expect(page({ language: "fr" } as never)).rejects.toMatchObject({
  code: "content.translation_invalid",
});
```

## Checkpoint 20261018-025012-drafts

### A682 Task9 — changed test checks and qualification

Authority: approved A682 design, One Save/Translate all sections; plan Task9 and Suggestions and draft ownership contract. Unit A, Spanish A and reset YES remain closed. Whole A682 is unfinished and unpublished.

No existing assertion or fixture changed. `content-translations-model.test.ts:7` and `content-translations-dialog.ts:43` change only their import path to `content-translations-legacy-model.js`. The legacy model is byte-identical to the original model at46b108db91a325fb2b7f8ca7e12ab082a6736de5; the original test body is byte-identical except that import. All145 matcher expressions remain. This does not qualify the new model against every legacy behavior: Task10 must migrate the applicable assertions and inventory deliberate spec changes while retiring the legacy module, old companion model and old DTO/client names.

`content-translations-model.multilingual.test.ts` adds52 real-model cases/148 matcher expressions covering four-part identity, clears/inheritance, explicit blank suppression, suggestion ownership/discard/freshness, complete/inherited fixes, 100 selected cells plus one retained overflow, unit field counts, exact UTF8 field/body bounds, stale ownership/default/unavailable review, and exact submitted snapshot commits including newer input/reverts/fixes. Raw AST expressions are in assertion-audit.json with current file:line references; source-final.patch is the actual change. The count is source structure, not fixture or runtime equivalence.

No previous money, VAT, login, permissions, drawer, fiscal, or root-guard expected value changed. Protected golden/immutability source files are byte-unchanged from feature base347c5fa4b7d735043533cda8565cdc7aca5a2ac1; both suites pass20 cases.

Qualification: initial37 constructor failures show the absent new interface only, not behavioral assertion proofs. The new config fixture's default property was corrected to the actual defaultLanguage shape before implementation. First implementation75PASS/1failed found an undersized synthetic byte fixture (262141 rather than overflow), fixed with an oversized input plus exact262144/262145 cases. Default-while-pending tests2 intended assertion failures were fixed by retaining submitted configuration. Later copied-snapshot/fresh hidden-fix and capacity-return tests4fail were fixed. New tests that passed immediately were characterization of the already implemented model, not additional RED claims.

Current source final seven dashboard suites223PASS0FAIL0SKIP; dashboard types/scoped ESLint/Prettier/whitespace pass. Targeted diagnostic model coverage with an external report directory:100 statements/96.22 branches/100 functions/100 lines,92 tests across new+original model suites. This is not package-wide coverage. The initial diagnostic95.18S/88.53B failure is retained, not omitted. Lit dev-mode warnings and an automatically changed occupied Vitest port appeared in successful diagnostic runs.

Six omissions in a complete independently frozen-installed candidate caught3/2/1/3/3/2 intended assertion failures: null clears, personal autofill fencing, Keep ownership, newer submitted snapshot handling, default-change review and retained101st input. Every restoration passed; final52PASS. Candidate matched6703 source paths at creation; final only later docs/backlog.md differed. Own candidate, parent, registration and all15 recorded install/control command process groups are absent; cleanup receipts retained. No final external review/PR/push/CI/readiness/finish/land claim.

Rulings: keep the original dialog/model/tests temporarily together until Task10's coordinated replacement, with no shipped compatibility route. edit now returns boolean so the consumer can handle unavailable/second-overflow input; it still retains the101st personal input with a blocking capacity fault. Task10 must gate new pristine fields during overflow and handle false explicitly. Costs if wrong: a missed final import audit could retain old behavior, or a missed return check could hide another input. Copying a batch is not the exact pending submission; commit ignores it rather than clearing personal edits.

Keep this inventory AND all older A682 inventories for the eventual one PR Changed test checks. Its first line must require existing venue folders reset/reseeded. This does not authorize any reset, A760 execution or protected-writer change.

Final Task9 follow-up: a new no-op-blank/concurrent-fill probe failed its review assertion. Tracing edit→inputs→receive→validate found that unchanged input retained only value/revision, while receive discarded non-staged page baselines. Input now retains original expected/owners/text/config metadata. A later external fill promotes that intentional blank to an explicitly reviewable cell; Keep still refuses a replacement owner. This is scoped to this new model, not a claim about an older released behavior. Two intended review failures plus the suggestion-priority case (101 instead of100) were observed before their minimal fixes.

Current final source:55 new cases/161 new matcher expressions, all145 old expressions unchanged. Seven dashboard suites226PASS0FAIL0SKIP; targeted model95PASS, coverage100S/95.34B/100F/100L. Final dashboard types/scoped ESLint/Prettier/whitespace pass. Two additional installed omissions caught3/1 intended assertion failures, restored final55PASS. The second complete candidate matched6703 source paths byte-for-byte immediately before cleanup; candidate/parent/registration and all7 recorded install/control groups absent. Earlier six controls and initial qualification remain as recorded above; those unchanged guards were not rerun. No whole-package coverage, editor integration or branch-ready claim.

## Checkpoint 20261018-033942-window

### A682 Task10 field-window checkpoint — changed test checks

This is an unpublished foundation within A682, not completion of Task10 or the feature.

No existing test file or fixture changes in this unit. All new behavioral checks are in
content-translations-window.test.ts; the a11y sibling exercises 32 locale/theme/width/state
renders in four parameterized cases. Keep ALL earlier A682 inventories for the final single PR.

The app-owned field view uses the final cell model, bounded language projections, keyed rows and
fields, focus/caret retention (including moving the focused row), distinct optional unit fields,
field-specific display-only fallback and explicit edit acceptance. It retains a focused off-page
row within the fifty-row mounting limit. A rejected value/error survives other accepted edits;
its getter and change event let the parent block saving it. Replacing the draft instance clears
its view-only rejection/focus state. The focus event names the exact cell and emits null on blur.
Rows expose accessible groups named from the staff parent/item. Parent HTTP paging, filters,
Show staged, save/retry/leave integration and retirement of the legacy model/contracts are OPEN.

Observed RED: rejected-message retention, missing rejection getter/session reset, accessible
item grouping and focus release all failed their intended assertions before their fixes.
The initial missing-module import executed no tests and is EXCLUDED as behavioral evidence.
Initial numeric locale aliases, native-control targeting, browser-name availability, error-node
selector and desktop-buffer count mistakes were new fixture/test setup errors; they are retained
in the logs and are not product proof. No old assertion was loosened to repair those errors.

The final 200-code fixture is canonical in Chromium and accepted, uniquely, by the actual server
language normalizer bundled and run in Node26.11.1. This Chromium's language picker returned148
named choices; deriving the fixture from it could not exercise200. The first Node probe commands
failed because root tsx/esbuild were unavailable; the qualified probe resolves esbuild from the
server package, bundles the real normalizer and checks all200 stored fixture codes. This is a
normalizer/uniqueness measurement, not a database-write or picker-capacity claim.

Independent frozen-installed full candidate: seven omission classes caught2/2/1/1/1/1/1 intended
assertion failures (projection/focus pin/focused row/native selection/capacity/rejection retention/
new session). One earlier focus-pin run had1 intended assertion and1 collateral null access;
its latter result is excluded. Presence assertions were added and the changed test rerun caught
2 intended assertions. Other cached control results were reused without unchanged mutation reruns.
Each qualified omission was restored and passed; latest installed final21PASS. New grouping and
focus-release behavior separately has observed source RED then final source/installed GREEN.

Final source8 selected suites239PASS. Diagnostic coverage of the new view only:100 statements,
98.18 branches,100 functions/lines. Initial92.45 branch diagnostic retained; missing load/parent/
no-fallback scenarios added without exclusions or threshold changes. Not whole-package coverage.
Dashboard types, four-file ESLint/Prettier and whitespace pass. Root style/native/pinned guards41PASS;
protected golden/immutability20PASS, both files unchanged from feature base347c5fa. Runtime logs
retain Lit dev-mode warnings; no pristine-console claim.32 renders were individually inspected;
latest screenshot byte comparison is in look-final-comparison.json.

Reservation audit:19 foreign trees, actual committed+dirty selected paths, saved in foreign-final.json.
Only unrelated B floor-layout and G course translation keys overlap strings.ts. No foreign file,
queue, process or worktree was edited. Main/origin f316485d011cf895501b4dcb085e56e2a3a6cca1 clean,
exact CI39086656964/licence39086656924 completedSUCCESS. No own merge or new H12 duty.

## Checkpoint 20261018-editor

### A682 Task10 editor integration: Changed test checks

Authority: docs/superpowers/plans/2026-10-17-a682-translations.md Task10, lines499–512, plus the approved design closure. The chosen language initializes Missing in and Jump to; fields, paging and Save use the final multilingual contracts. Keep this inventory AND ALL older A682 inventories for the single eventual PR. This is an unpublished checkpoint, not task/feature completion.

Existing checks retain draft/Keep/Discard/navigation/security/unload, saved-event ordering, exact typed text and tokens, run counts/states/refusals/progress/late-answer expectations and report-refresh failure behavior. Changed request checks preserve every earlier kind/id/expected/text and add language/field to the one batch. The suggestion query is now the explicit empty object. The data-table presence checks become bounded-window/native-field readiness checks. Four language-specific heading checks become the generic editor heading PLUS exact Missing in and Jump language checks. No money, permission, fiscal or root-guard expected value changes in this delta.

Fixtures: the unsaved suite's result/suggestionApi and Translate all suite's translations now supply item/cell/configuration responses. Unsaved save replies return the submitted saved cells; suggestions have exact cell/token identities. Its150 suggestions arrive as100+50 through an explicit More suggestions press. The screen's api/default reader, added-language reader and real-PUT fixture use final pages; the real PUT returns its saved Catalan cell. Reopening's exact desktop projection pins1280px rather than inheriting another case's viewport. No server compatibility route was added.

The table below gives every replaced matcher with its original line. Each file's added matcher list below supplies the exact current line and value, including the stronger replacements. The JSON inventory retains the complete expressions; token matching is structural source comparison, not fixture/runtime equivalence.

#### apps/dashboard/src/widgets/content-translations-pages.test.ts

Before 128; current 131; unchanged 128.

- Current new/replacement matcher: `apps/dashboard/src/widgets/content-translations-pages.test.ts:105`: `expect(reader.page).not.toBeNull()`
- Current new/replacement matcher: `apps/dashboard/src/widgets/content-translations-pages.test.ts:107`: `expect(reader.suggestions?.cloudOrigin).toBe("https://new.example")`
- Current new/replacement matcher: `apps/dashboard/src/widgets/content-translations-pages.test.ts:110`: `expect(reader.suggestions?.cloudOrigin).toBe("https://new.example")`

#### apps/dashboard/src/widgets/content-translations-dialog.unsaved.test.ts

Before 54; current 59; unchanged 50.

- Original matcher replaced: `apps/dashboard/src/widgets/content-translations-dialog.unsaved.test.ts:80`: `expect(form.shadowRoot!.querySelector("wt-data-table")).not.toBeNull()`
- Original matcher replaced: `apps/dashboard/src/widgets/content-translations-dialog.unsaved.test.ts:189`: `expect(app.api.saveContentTranslations).toHaveBeenCalledExactlyOnceWith("es", { edits: [{ kind: "product", id: "dish", expected: "baseline", text: "Sopa nueva" }], })`
- Original matcher replaced: `apps/dashboard/src/widgets/content-translations-dialog.unsaved.test.ts:308`: `expect(form.shadowRoot!.querySelector("wt-data-table")).not.toBeNull()`
- Original matcher replaced: `apps/dashboard/src/widgets/content-translations-dialog.unsaved.test.ts:357`: `expect(api.saveContentTranslations).toHaveBeenCalledExactlyOnceWith("es", { edits: [{ kind: "product", id: "dish", expected: "baseline", text: "CLIENT-es Sopa del día" }], })`
- Current new/replacement matcher: `apps/dashboard/src/widgets/content-translations-dialog.unsaved.test.ts:107`: `expect(form.shadowRoot!.querySelector("[data-test=loading]")).toBeNull()`
- Current new/replacement matcher: `apps/dashboard/src/widgets/content-translations-dialog.unsaved.test.ts:109`: `expect( form .shadowRoot!.querySelector("dashboard-content-translation-window") ?.shadowRoot?.querySelector("wt-input"), ).toBeTruthy()`
- Current new/replacement matcher: `apps/dashboard/src/widgets/content-translations-dialog.unsaved.test.ts:223`: `expect(app.api.saveContentTranslations).toHaveBeenCalledExactlyOnceWith({ edits: [ { kind: "product", id: "dish", language: "es", field: "name", expected: "baseline", text: "Sopa nueva", }, ], })`
- Current new/replacement matcher: `apps/dashboard/src/widgets/content-translations-dialog.unsaved.test.ts:286`: `expect(field(form).closest("section")!.querySelector("a")).not.toBeNull()`
- Current new/replacement matcher: `apps/dashboard/src/widgets/content-translations-dialog.unsaved.test.ts:299`: `expect(field(form).closest("section")!.querySelector("a")).not.toBeNull()`
- Current new/replacement matcher: `apps/dashboard/src/widgets/content-translations-dialog.unsaved.test.ts:353`: `expect(form.shadowRoot!.querySelector("[data-test=loading]")).toBeNull()`
- Current new/replacement matcher: `apps/dashboard/src/widgets/content-translations-dialog.unsaved.test.ts:355`: `expect( form .shadowRoot!.querySelector("dashboard-content-translation-window") ?.shadowRoot?.querySelector("wt-input"), ).toBeTruthy()`
- Current new/replacement matcher: `apps/dashboard/src/widgets/content-translations-dialog.unsaved.test.ts:409`: `expect(api.saveContentTranslations).toHaveBeenCalledExactlyOnceWith({ edits: [ { kind: "product", id: "dish", language: "es", field: "name", expected: "baseline", text: "CLIENT-es Sopa del día", }, ], })`
- Current new/replacement matcher: `apps/dashboard/src/widgets/content-translations-dialog.unsaved.test.ts:438`: `expect(form.shadowRoot!.querySelector("[data-test=suggestion-capacity]")).not.toBeNull()`

#### apps/dashboard/src/widgets/content-translations-dialog.translate-all.test.ts

Before 75; current 75; unchanged 72.

- Original matcher replaced: `apps/dashboard/src/widgets/content-translations-dialog.translate-all.test.ts:148`: `expect(getContentSuggestions).toHaveBeenCalledWith()`
- Original matcher replaced: `apps/dashboard/src/widgets/content-translations-dialog.translate-all.test.ts:333`: `expect(el.shadowRoot!.querySelector("wt-data-table")).not.toBeNull()`
- Original matcher replaced: `apps/dashboard/src/widgets/content-translations-dialog.translate-all.test.ts:406`: `expect(api.getContentSuggestions).toHaveBeenCalledWith()`
- Current new/replacement matcher: `apps/dashboard/src/widgets/content-translations-dialog.translate-all.test.ts:155`: `expect(getContentSuggestions).toHaveBeenCalledWith({})`
- Current new/replacement matcher: `apps/dashboard/src/widgets/content-translations-dialog.translate-all.test.ts:340`: `expect(el.shadowRoot!.querySelector("dashboard-content-translation-window")).not.toBeNull()`
- Current new/replacement matcher: `apps/dashboard/src/widgets/content-translations-dialog.translate-all.test.ts:413`: `expect(api.getContentSuggestions).toHaveBeenCalledWith({})`

#### apps/dashboard/src/screens/content-languages-screen.test.ts

Before 219; current 227; unchanged 211.

- Original matcher replaced: `apps/dashboard/src/screens/content-languages-screen.test.ts:986`: `expect(translations(el).shadowRoot!.querySelector("wt-data-table")).not.toBeNull()`
- Original matcher replaced: `apps/dashboard/src/screens/content-languages-screen.test.ts:990`: `expect(translationModal(el).heading).toContain("Francés")`
- Original matcher replaced: `apps/dashboard/src/screens/content-languages-screen.test.ts:1008`: `expect(client.getContentTranslationTargets).toHaveBeenCalledExactlyOnceWith("en", {})`
- Original matcher replaced: `apps/dashboard/src/screens/content-languages-screen.test.ts:1012`: `expect(translationModal(el).heading).toContain(name("en"))`
- Original matcher replaced: `apps/dashboard/src/screens/content-languages-screen.test.ts:1050`: `expect(translationModal(el).heading).toContain(name("de"))`
- Original matcher replaced: `apps/dashboard/src/screens/content-languages-screen.test.ts:1051`: `expect(client.getContentTranslationTargets).toHaveBeenNthCalledWith(2, "de", {})`
- Original matcher replaced: `apps/dashboard/src/screens/content-languages-screen.test.ts:1060`: `expect(translationModal(el).heading).toContain(name("de"))`
- Original matcher replaced: `apps/dashboard/src/screens/content-languages-screen.test.ts:1202`: `expect(client.saveContentTranslations).toHaveBeenCalledExactlyOnceWith("ca", { edits: [{ kind: "product", id: "dish", expected: "baseline", text: "Sopa" }], })`
- Current new/replacement matcher: `apps/dashboard/src/screens/content-languages-screen.test.ts:998`: `expect( translations(el).shadowRoot!.querySelector("dashboard-content-translation-window"), ).not.toBeNull()`
- Current new/replacement matcher: `apps/dashboard/src/screens/content-languages-screen.test.ts:1004`: `expect(translationModal(el).heading).toBe(t("content_languages.edit_translations"))`
- Current new/replacement matcher: `apps/dashboard/src/screens/content-languages-screen.test.ts:1005`: `expect( translations(el).shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>( "[name=missing]", )!.value, ).toBe("fr")`
- Current new/replacement matcher: `apps/dashboard/src/screens/content-languages-screen.test.ts:1010`: `expect( translations(el).shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>("[name=jump]")! .value, ).toBe("fr")`
- Current new/replacement matcher: `apps/dashboard/src/screens/content-languages-screen.test.ts:1031`: `expect(client.getContentTranslationTargets).toHaveBeenCalledExactlyOnceWith({ languages: ["ca", "en", "de"], missing: { mode: "language", language: "en" }, })`
- Current new/replacement matcher: `apps/dashboard/src/screens/content-languages-screen.test.ts:1038`: `expect(translationModal(el).heading).toBe(t("content_languages.edit_translations"))`
- Current new/replacement matcher: `apps/dashboard/src/screens/content-languages-screen.test.ts:1039`: `expect( translations(el).shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>( "[name=missing]", )!.value, ).toBe("en")`
- Current new/replacement matcher: `apps/dashboard/src/screens/content-languages-screen.test.ts:1044`: `expect( translations(el).shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>("[name=jump]")! .value, ).toBe("en")`
- Current new/replacement matcher: `apps/dashboard/src/screens/content-languages-screen.test.ts:1086`: `expect(translationModal(el).heading).toBe(t("content_languages.edit_translations"))`
- Current new/replacement matcher: `apps/dashboard/src/screens/content-languages-screen.test.ts:1087`: `expect( translations(el).shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>( "[name=missing]", )!.value, ).toBe("de")`
- Current new/replacement matcher: `apps/dashboard/src/screens/content-languages-screen.test.ts:1092`: `expect( translations(el).shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>("[name=jump]")! .value, ).toBe("de")`
- Current new/replacement matcher: `apps/dashboard/src/screens/content-languages-screen.test.ts:1096`: `expect(client.getContentTranslationTargets).toHaveBeenNthCalledWith(2, { languages: ["ca", "en", "de"], missing: { mode: "language", language: "de" }, })`
- Current new/replacement matcher: `apps/dashboard/src/screens/content-languages-screen.test.ts:1108`: `expect(translationModal(el).heading).toBe(t("content_languages.edit_translations"))`
- Current new/replacement matcher: `apps/dashboard/src/screens/content-languages-screen.test.ts:1109`: `expect( translations(el).shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>( "[name=missing]", )!.value, ).toBe("de")`
- Current new/replacement matcher: `apps/dashboard/src/screens/content-languages-screen.test.ts:1114`: `expect( translations(el).shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>("[name=jump]")! .value, ).toBe("de")`
- Current new/replacement matcher: `apps/dashboard/src/screens/content-languages-screen.test.ts:1271`: `expect(client.saveContentTranslations).toHaveBeenCalledExactlyOnceWith({ edits: [ { kind: "product", id: "dish", language: "ca", field: "name", expected: "baseline", text: "Sopa", }, ], })`

New editor suite:26 cases cover initial bounded reads,200 canonical language tags/101 total rows at390/1280, explicit paging/filtering/Show staged, native input/caret retention, separate language edits and clears, four uncertain-error shapes and exact object/body retry, passive reads/active writes, read/action error separation, stale openings, newest-read release, explicit unstaging and101-field blocking, reconnect/live resubscription and eight native EN/ES/theme/size renders (ready+retry,16captures). The new reader case rejects an opening suggestion answer arriving after a fresher page. All of these current cases are included in the243-pass selected source run.

Pending: original standard dialog, suggestion-draft and original full a11y suites still need their coordinated migration; they are deliberately retained, not deleted or declared passing. Reintroduce/preserve every useful legacy behavior while adding field-specific review/Use fix/notes/discovery, and retire the unused legacy model and client/DTOs before publication. Task10 and A682 remain incomplete.

## Checkpoint 20261018-integration

### A682 Task10 page coordinator checkpoint 5004ce09aff65f6d999d121c9b69c61dab112756

Authority: approved design §§One editor / One Save / Translate all and plan Task10, on the existing in-progress branch, original start2026-10-17 16:00.

Existing assertions/fixtures changed: **none** in this checkpoint. New file `apps/dashboard/src/widgets/content-translations-pages.test.ts:1` adds46 reader cases; `content-translations-pages.ts:1` implements the page coordinator. `docs/backlog.md:1048` records its incomplete integration. The named entries and all behavior/fixture adjustments in earlier A682 inventories still belong in the eventual single PR's Changed test checks section.

Observed RED/GREEN: bounded reads and late publication against the stub; hidden suggestions and configuration; waiting-fix filter clearing/failed navigation; unedited focus-cell retention; refreshed visible facts. See qualification-notes.md for excluded import/interface/fixture failures. The original 200 numeric-region input was unsuitable after ICU alias normalization; the final200-name fixture is identical to the field view's language list and is checked with Chromium Intl. This is reader projection, not a200-language saved database or whole dialog acceptance claim.

Fresh current source11selected suites359PASS; protected20PASS and both files unchanged since347c5fa; scopedtypes/lint/format/whitespacePASS. Reader-only coverage99.4S96.42B100F100L. Independently frozen-installed candidate162PASS, eight one-at-a-time omission controls caught intended assertions and were restored. Complete6708-path comparison, owned candidate/registration removal and zero candidate-CWD processes recorded. Whole package coverage, whole item readiness, UI integration and future presentation remain unfinished.

No existing money/VAT/login/permission/drawer/fiscal/root-guard check changed; no new owner decision, reset, A760, partial PR, push or final review. Continue the same item and keep ALL previous inventories.

## Checkpoint 20261018-transport-notes

### A682 Task10 transport and regional notes: changed test checks

No existing assertion or fixture changed in this checkpoint. changed-existing-tests.json records the empty existing-test list and two new files. Preserve this inventory AND every previous A682 inventory for the eventual one PR Changed test checks section.

- apps/dashboard/src/api/client-translations.test.ts: multilingual projected reads (including an independent Missing in language), exact repeated retained references, one complete multi-language cell batch with abbreviation clear, active background writes, and precise four-part refusal identity. Authority: approved plan Tasks7/10, route DTOs and One Save one transaction.
- apps/dashboard/src/screens/content-languages-screen.layout.test.ts: exact full regional warning wording, measured390/1280 viewport, natural word wrapping, every text line inside its cell, rendered native action and SVG, real popup activation/close, and axe across EN/ES/light/dark. Authority: approved A682 point5 and Task10 regional wrapping/pinned Actions. Eight final PNGs retained in look/.

No root guard, protected fiscal file, money/VAT/permission/login/drawer assertion or fixture changed. No new owner decision is needed. The final parent editor/Save migration, Use fix, future snapshots and overall acceptance remain incomplete.

## Checkpoint 20261020-0853

### A682 rebase integration: changed checks and fixture additions

Compare this firing against rebased checkpoint `71f906059702c7a9b654faf6c8b153e3f62fb3ce`; earlier A682 inventories remain required for the sole final PR. `assertions.json` compares TypeScript syntax trees: 9,850 of 9,857 old matcher expressions retained across 33 changed test files. This is a structural comparison, not proof every assertion is useful.

- `apps/dashboard/src/widgets/unit-form.staff-identity.test.ts`: two exact payload expectations gain only `measure: false`. Every prior staff/empty/disabled-map value remains. Authority: landed A821f measure contract, A682 Task3 combined fields, owner whole-shape addition rule. Two-file 46 PASS.
- `apps/dashboard/src/widgets/unit-form.test.ts`: two exact payload expectations gain only `measure: false`, with prior precision and partial map values unchanged. Same authority and run.
- `apps/till/src/screens/till-table-order-screen.new-order-quantities.test.ts`: the empty translated abbreviation case now expects the explicit staff abbreviation `su`. Nonempty punctuation, EN/ES decimal marks, three-place quantity and submission assertions remain. Authority: approved required unit staff pair and Task3 default/staff display fallback. Two expected failures first; corrected owning suite12 PASS within three-file44 PASS.
- `apps/dashboard/src/dashboard-app.test.ts`: the four existing shell leave routes use multilingual cells, matching configuration, count summaries and the window's current native input/editor link. Replace the obsolete table-presence check with window presence and an extra awaited native-field check. Personal input/expected value becomes English `New customer soup`; Keep preserves it and prevents navigation/locale/logout, Discard performs the same original route. All route outcomes and assertions stay; source-structure migration follows Tasks9–11, input wording follows the English-only decision. Four failures with the retired structure; migrated4 PASS. Removing personal draft tracking in the disposable candidate causes4 intended AssertionErrors, restoration4 PASS. Final complete shell/unit result is dashboard-final.log.

Fixture-only additions are in `added-unit-fixtures.json`, `added-fixture-contracts.json` and source-final.patch (final diff is authoritative: preliminary inventories also list reverted spread overrides). New required unit staff pairs are explicit English values. New extra presentation facts preserve existing staff/customer/kitchen values and add null relative-variant fields. The unit create stub returns the supplied staff pair. No prior price, VAT, quantity, permissions, drawer, fiscal or historical-snapshot value changes. Two server and seven catalogue measure-unit create inputs gain only the required pair. Existing suggestion evidence/paging cases call the landed paged collector with cursor0/nextCursor null; every existing assertion remains.

Rebase conflicts also combine staff fields with the landed measure switch in unit helpers, API test payloads and form payloads. Prior `measure` expectations remain; no generic guard changed to manufacture green. The only root guard change relative to main remains the previously OWNER-approved reset declaration, renumbered to catalogue/0035_unit_staff_identity after regeneration. Generated SQL is byte-identical to original0033 staff SQL; parity.json retains its hash.

## Checkpoint 20261020-0921

### A682 Task12 changed test checks, FYI, no answer needed

Authority: `docs/superpowers/plans/2026-10-17-a682-translations.md:527–543`, particularly the required staff fallback signatures, one default key for unit presentation, and the separate prepared full-name context. Owner decision2026-10-05 permits checks whose required behavior changes.

- `apps/server/src/working-order.test.ts`: the fractional-unit retained-order assertion changes its context-name key from locale `es-ES` to content-language `es`; the synthetic Each retained-order assertion changes its full multilingual unit name to the one prepared default-language entry. Both retain all identity, price, precision, hardware, stored-name and live-rename assertions. This changes preparation of new test orders; no historical reader is changed.
- `apps/server/src/modifier-selection.test.ts`: two direct edit calls now state default language `en`. The weighted added-extra assertion changes `{en:kg, es:kg}` to exactly `{en:kg}`. Quantity, physical quantity, portion, unit precision, full context, price and VAT checks remain.
- `packages/catalogue/src/default-language-text.test.ts`: all five calls supply a separate staff value. Unrelated-language fallback changes to exact staff fallback; empty maps and a null map now produce the staff text under the explicit key. Existing default-text and exact key checks remain. The coffee fixture uses English text in its existing language keys; it still checks the same default selection.

AST inventory `assertions.json`:701previous matcher expressions and701current, eight one-for-one syntax changes,693exact matches. Two expressions only gain an argument/English fixture; all other changes above follow Task12. This is static expression accounting, not a claim about generated cases. Preserve every earlier A682 Changed-test inventory in the eventual sole PR.

New files exercise actual preparation/pricing; spies observe the real pricing inputs/results without replacing its implementation. No shared fixture, existing money/VAT/refusal/permission/drawer check, fiscal fixture, golden check or root guard is changed in this delta.

## Checkpoint conflicts

### A682 continuation: changed test checks

This is an unpublished checkpoint on `feat/a682-translations`, based on signed-off `5727c8ab1e49169abaed87e3e6c67287f416b8ae`. Carry this inventory and all earlier inventories into the eventual single PR's **Changed test checks** section. A682 is incomplete.

Authority: approved A682 design §§One editor / One Save / Translate all, and implementation plan Tasks10–11. The all-language editor replaces the single-language table and required-default companion; notes keep their existing editor links even outside the visible item page. RUNNER/THE RULE explicitly permits whole-shape keys for added fields and equally strict checks of spec-changed behavior.

- `apps/server/src/content-suggestions-api.test.ts`: the existing exact HTTP response expected every prior value; it now also requires `item: {name: "STAFF Bread"}` on the listed suggestion. Its first observed failure was solely this extra metadata. Every existing response value remains exact. Real catalogue listing separately checks an option label's current staff name and parent editor, including a rename between reads.
- `apps/dashboard/src/widgets/content-translations-dialog.a11y.test.ts`: the original loading/empty/ready/invalid/refused/conflict/unavailable/review matrix remains across EN/ES × light/dark ×390/1280. Fixture DTOs use config/cell pages, and native field/review/note selectors move from the removed table to the multilingual window and parent review panels. The former invalid-state trigger was a missing required-default companion, deliberately removed by A682; its replacement enters 4098 UTF-8 bytes, asserts the exact name-byte refusal and zero save requests. Default-language native input stays empty. Bounds, open-modal, recoverable Close and axe assertions remain; uncertain and explicit-batch-review states and a visibly rendered secondary review button are added. Suggestion state presence checks move to per-id parent panels and additionally assert Suggested, correction, placeholder and stale text.
- Suggestion fixture builders in fixes, multilingual model, old model, old drafts, unsaved, pages and a11y suites gain the required current staff/editor metadata. Existing matcher expressions outside the a11y migration and the one HTTP whole shape are unchanged. The original standard and drafts dialog suites still need their coordinated migration; no pass is claimed for them. Adding metadata alone does not migrate those suites.

The TypeScript AST audit below reports 1038 prior matcher expressions: 1029 are retained verbatim after normalized printing, eight a11y expressions move to equivalent current controls/selectors and one response whole shape gains the new key. Current count1130 includes new checks. This is an expression inventory, not proof of behavior; executed checks are in verification.json/raw logs.

Observed red/green: missing batch review3fail/74pass →77pass; capacity200instead100 →57pass; note metadata store1fail/23pass →24pass; off-page link/name9fail/33pass and stale-parent1fail →43pass. The old a11y run failed on the removed table; its migrated suite8passes. An inspection found false changed-name copy on unchanged forced review; the added assertion failed, then passed with truthful unconfirmed-save wording. Final affected review27pass, affected review+a11y35pass, earlier surrounding13suites389pass, installed final4suites135pass and catalogue24pass. Source catalogue64/server75/root41/protected20 and scoped types/lint/format pass.

Seven installed omissions fail intended assertions and each passes after restoration: original evidence, capacity, every-field review, failed-read Retry retention, opening generation, latest note parent, listed parent metadata. The FIRST opening-generation omission passed because the test read before the whole continuation finished; that run is excluded as proof. After awaiting a real animation frame following the held answer, the omission fails the expected panel assertion, and restored success/failure cases pass. See control-qualification.txt and controls.json.

Visual receipt: final uncertain and batch-review panels inspected in all eight EN/ES/theme/size combinations (16 final crops). Full real-Chromium matrix runs axe and bounds. At390/700 the modal body is intentionally scrolled to review/field content, so these are partial body crops, not full app/server or physical-device acceptance. Final wording states unconfirmed save rather than claiming unchanged text changed. Lit development and occupied-port warnings retained. The initial formatter brace pattern miss and the typecheck revealing incomplete metadata fixtures are corrected; no pass relies on those failed commands.

#### Exact replaced expressions (old source lines at checkpoint base)

##### apps/dashboard/src/widgets/content-translations-dialog.a11y.test.ts

Line 165:

```ts
expect(table!.shadowRoot!.querySelector("[data-test=review-product-one]")).not.toBeNull();
```

Line 175:

```ts
expect(
  el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=close]")!.disabled,
).toBe(false);
```

Line 192:

```ts
expect(field.getBoundingClientRect().left).toBeGreaterThanOrEqual(bodyBounds.left);
```

Line 193:

```ts
expect(field.getBoundingClientRect().right).toBeLessThanOrEqual(bodyBounds.right);
```

Line 201:

```ts
expect(button.getBoundingClientRect().left).toBeGreaterThanOrEqual(bodyBounds.left);
```

Line 202:

```ts
expect(button.getBoundingClientRect().right).toBeLessThanOrEqual(bodyBounds.right);
```

Line 297:

```ts
expect(el.shadowRoot!.querySelector("wt-data-table")).not.toBeNull();
```

Line 309:

```ts
expect(table.shadowRoot!.querySelector(selector), selector).not.toBeNull();
```

##### apps/server/src/content-suggestions-api.test.ts

Line 264:

```ts
expect(await read(http)).toEqual({
  config: { defaultLanguage: "es", languages: ["es", "en"] },
  required: [],
  configuration: expect.any(String),
  waitingFixes: 0,
  service: "on",
  cloudOrigin: CLOUD,
  next: null,
  run: expect.objectContaining({ state: "done", waiting: 1, opened: true }),
  suggestions: [
    {
      id: expect.any(String),
      kind: "product",
      itemId: id,
      language: "en",
      text: "EN STAFF Bread",
      placeholder: false,
      fix: null,
      stale: false,
      cell: { kind: "product", id, language: "en", field: "name" },
      expected: expect.any(String),
    },
  ],
});
```

Current expressions, added expressions and precise current lines: `assertion-audit.json`. Full source diff: `source-final.patch`. Earlier receipt inventories remain authoritative for earlier changes.

## Checkpoint drafts

### A682 original draft-suite migration — changed test checks

Base: `41ac3f153b7545a44929b8e803742ad7e80ca2fe`. Full candidate remains unpublished; this is not a whole-feature completion receipt.

Authority: approved A682 design “One Save, one transaction” and “Translate all and Use fix”; plan Task10 (lines499–512), Task11 (lines514–525), bounded contracts and draft ownership. UnitA/SpanishA/resetYES remain closed.

All48 original case groups are mapped in `test-map.json`, with exact old/new file lines and matcher expressions. The old52 runtime cases become54 behavior cases: the two-language personal-preservation loop is split into independent cases, and one between-readers lifecycle case is added. Eight additional capacity/accessibility states yield62 total draft-suite cases. The source AST audit reports syntax, not behavior equivalence.

#### Intentional behavior replacements

- Default companions/required checks become independent optional-language cells: an English suggestion is not a prerequisite for Spanish; personal text can save with the other field blank. This is the approved optional-text rule, not weaker validation.

- Row-wide Discard and partial-group-failure suppression become explicit per-id actions. A successful id clears only its borrowed cell; a refused different id retains its borrowed draft, with the same server.internal refusal preserved. Personal values survive both actions. A language change reopens the same multilingual editor and can stage both enabled languages.

- Cursor-draining assertions become one initial suggestion page and explicitly requested continuations. Previously borrowed text survives a refused or mismatched later page. Review latest refreshes saved cells; it does not implicitly fetch further suggestion pages.

- Automatic insertion of page-omitted rows becomes retained cell drafts plus Show staged. Note metadata needs no extra item read. At most100 refs per cell read and50 distinct shown items preserve bounded reads. Disabled/gone/named/stale targets still cannot become borrowed edits.

- Stale refusals include kind/id/language/field and retain the original value plus a field refusal for deliberate retry/review, rather than silently dropping an unrelated language or draft.

- The100 limit counts cells. Empty fields stay editable while borrowed drafts can yield room to personal input; saves still assert the exact100-item body. Full100 personal cells show a status; >100 keeps its alert/refusal. EN/ES literal status checks distinguish reaching the limit from exceeding it.

#### Assertions preserved without changing expected results

`content-translations-dialog.fixes.test.ts:458` and `:489`: two tests now await the exact Discard promise plus the response-delivery animation frame before reading UI state. Every123 existing matcher is byte-equivalent under the AST printer; no checks, expected codes or values are weakened. This follows testing-guide “Wait for a resolved response to reach the screen”.

No money, VAT, permissions, drawer, fiscal or root-guard expectation changes. Both protected fiscal files are byte-identical to347c5fa.

#### Verification and limits

- Initial original fixture/selector failure (`original-red.log`) is a migration signal, not production RED evidence. First migrated run had ten failures: most were helper read-wait or fixture issues; the missing-suggestion normalization and full-batch status were production gaps. Those targeted assertions failed before implementation. `capacity-red.log`, `truthful-capacity-red.log`, `not-found-green.log` and subsequent runs retain the sequence.

- Source18complete translation suites680PASS; later test-only between-readers addition included in final2suites105PASS. Protected20/rootUI41/types/4-filelint/sourceformat/whitespacePASS. Final installed candidate62PASS, with six one-at-a-time controls caught and restored. Exact command/count/exit logs remain here. No package coverage or whole-branch readiness claim.

- The first deleted-read control survived because the live reader had already dismissed the id; `control-deleted-read.log` is explicitly not proof. A new controlled configuration wait completes deletion between readers; the same omission then fails the intended empty-field assertion (`control-deleted-read-between.log`). All source is restored after every control.

- Eight source EN/ES/light/dark/measured390/1280 capacity images inspected. The phone image scrolls the dialog body to the status; the title is above that crop. These show the standalone capacity state, not complete-app/server/physical acceptance. The initial images exposed reuse of “exceeds100” at exactly100; the separate batch_full key and literal EN/ES checks correct it. Final hashes in look-final.json.

- Qualification: migrated-second overlapped briefly with the first isolated not-found check; its results are not final verification. A first screenshot-montage helper lackedPillow after candidate setup; direct original-image inspection replaced it. All final passing source/candidate runs completed independently. Initial TypeScriptHTMLElement/updateComplete error was corrected with the registered element type; final types exit0. Lit-development/occupied-port warnings remain in raw logs.

#### Per-case old and new receipts

##### fills suggestions as drafts marked Suggested and opens with Save enabled

Old `content-translations-dialog.drafts.test.ts:182` → current `:310`: fills suggestions as drafts marked Suggested and opens with Save enabled. Authority: Task10/11 and the relevant replacement category above.

Old checks:

```text
186: expect(field(el, "one")!.value).toBe("CLIENT-es one")
187: expect(q(el, "[data-test=suggested-product-one]")!.textContent!.trim()).toBe(t("suggestions.suggested"))
190: expect(q(el, "[data-test=discard-product-one]")).not.toBeNull()
191: expect(field(el, "two")!.value).toBe("")
192: expect(q(el, "[data-test=suggested-product-two]")).toBeNull()
193: expect(q(el, "[data-test=discard-product-two]")).toBeNull()
194: expect(save(el).disabled).toBe(false)
195: expect(save(el).variant).toBe("primary")
197: expect(field(el, "one")).not.toBeNull()
198: expect(field(el, "two")).toBeNull()
```

Current checks:

```text
314: expect(field(el, "one")!.value).toBe("CLIENT-es one")
315: expect(note(el, "s1")!.textContent).toContain(t("suggestions.suggested"))
316: expect(discardButton(el, "s1")).not.toBeNull()
317: expect(field(el, "two")!.value).toBe("")
318: expect(save(el).disabled).toBe(false)
319: expect(save(el).variant).toBe("primary")
321: expect(field(el, "one")).not.toBeNull()
322: expect(field(el, "two")).toBeNull()
```

##### fills a missing default only when its default-language suggestion came too

Old `content-translations-dialog.drafts.test.ts:200` → current `:324`: fills each optional language independently, including the default. Authority: Task10/11 and the relevant replacement category above.

Old checks:

```text
214: expect(field(el, "one")!.value).toBe("CLIENT-es one")
215: expect(field(el, "one", "defaultText")!.value).toBe("CLIENT-en one")
216: expect(field(el, "two")!.value).toBe("")
217: expect(field(el, "two", "defaultText")).toBeNull()
```

Current checks:

```text
335: expect(field(el, "one")!.value).toBe("CLIENT-es one")
336: expect(field(el, "one", "en")!.value).toBe("CLIENT-en one")
337: expect(field(el, "two")!.value).toBe("CLIENT-es two")
338: expect(field(el, "two", "en")!.value).toBe("")
339: expect(field(el, "two", "en")!.required).toBe(false)
```

##### reads every suggestion page before filling

Old `content-translations-dialog.drafts.test.ts:219` → current `:341`: reads one suggestion page at a time and fills further pages only on request. Authority: Task10/11 and the relevant replacement category above.

Old checks:

```text
227: expect(api.getContentSuggestions).toHaveBeenCalledWith({
    after: "1",
    configuration: "suggestion-config",
})
231: expect(api.getContentSuggestions).toHaveBeenCalledWith({
    after: "2",
    configuration: "suggestion-config",
})
235: expect(field(el, "three")!.value).toBe("CLIENT-es three")
```

Current checks:

```text
349: expect(api.getContentSuggestions.mock.calls).toEqual([[{}]])
350: expect(field(el, "three")!.value).toBe("")
352: expect(api.getContentSuggestions).toHaveBeenLastCalledWith({
    after: "1",
    configuration: "configuration-one",
})
356: expect(field(el, "two")!.value).toBe("CLIENT-es two")
358: expect(api.getContentSuggestions).toHaveBeenLastCalledWith({
    after: "2",
    configuration: "configuration-one",
})
362: expect(field(el, "three")!.value).toBe("CLIENT-es three")
```

##### saves suggested and typed names together, and an edited suggestion as typed

Old `content-translations-dialog.drafts.test.ts:237` → current `:364`: saves suggested and typed names together, and an edited suggestion as typed. Authority: Task10/11 and the relevant replacement category above.

Old checks:

```text
245: expect(q(el, "[data-test=suggested-product-two]")).toBeNull()
248: expect(el.open).toBe(false)
249: expect(api.saveContentTranslations).toHaveBeenCalledExactlyOnceWith("es", {
    edits: [
        { kind: "product", id: "one", expected: "baseline-one", text: "CLIENT-es one" },
        { kind: "product", id: "two", expected: "baseline-two", text: "Croqueta casera" },
        { kind: "product", id: "three", expected: "baseline-three", text: "Pan" },
    ],
})
```

Current checks:

```text
372: expect(note(el, "s2")!.textContent).not.toContain(t("suggestions.suggested"))
375: expect(el.open).toBe(false)
376: expect(api.saveContentTranslations).toHaveBeenCalledExactlyOnceWith({
    edits: [
        submitted("one", "CLIENT-es one"),
        submitted("two", "Croqueta casera"),
        submitted("three", "Pan"),
    ],
})
```

##### Discard deletes each of the row's suggestions in turn and empties the row

Old `content-translations-dialog.drafts.test.ts:257` → current `:384`: Discard deletes only its named suggestion; each language has a separate action. Authority: Task10/11 and the relevant replacement category above.

Old checks:

```text
268: expect(field(el, "one")!.value).toBe("")
269: expect(api.discardContentSuggestion.mock.calls).toEqual([["s1"], ["s2"]])
270: expect(field(el, "one", "defaultText")).toBeNull()
271: expect(q(el, "[data-test=suggested-product-one]")).toBeNull()
272: expect(q(el, "[data-test=discard-product-one]")).toBeNull()
273: expect(save(el).disabled).toBe(true)
```

Current checks:

```text
395: expect(field(el, "one")!.value).toBe("")
396: expect(api.discardContentSuggestion.mock.calls).toEqual([["s1"]])
397: expect(field(el, "one", "en")!.value).toBe("CLIENT-en one")
399: expect(field(el, "one", "en")!.value).toBe("")
400: expect(note(el, "s1")).toBeNull()
401: expect(note(el, "s2")).toBeNull()
402: expect(save(el).disabled).toBe(true)
```

##### a suggestion the server no longer holds counts as discarded; any other refusal is shown

Old `content-translations-dialog.drafts.test.ts:275` → current `:404`: a suggestion the server no longer holds counts as discarded; any other refusal is shown. Authority: Task10/11 and the relevant replacement category above.

Old checks:

```text
283: expect(field(el, "one")!.value).toBe("")
286: expect(bottomMessage(el)).toBe(codeMessage("server.internal"))
287: expect(field(el, "two")!.value).toBe("CLIENT-es two")
288: expect(q(el, "[data-test=suggested-product-two]")).not.toBeNull()
```

Current checks:

```text
412: expect(field(el, "one")!.value).toBe("")
415: expect(bar(el).error).toBe(codeMessage("server.internal"))
416: expect(field(el, "two")!.value).toBe("CLIENT-es two")
417: expect(note(el, "s2")!.textContent).toContain(t("suggestions.suggested"))
```

##### a Discard refused after another of the row's suggestions was deleted empties the row, shows the refusal, and Save leaves the row out

Old `content-translations-dialog.drafts.test.ts:290` → current `:419`: a refused independent Discard preserves its suggestion after an earlier language was deleted. Authority: Task10/11 and the relevant replacement category above.

Old checks:

```text
306: expect(bottomMessage(el)).toBe(codeMessage("server.internal"))
308: expect(api.discardContentSuggestion.mock.calls).toEqual([["s1"], ["s2"]])
309: expect(field(el, "one")!.value).toBe("")
310: expect(q(el, "[data-test=suggested-product-one]")).toBeNull()
312: expect(el.open).toBe(false)
313: expect(api.saveContentTranslations).toHaveBeenCalledExactlyOnceWith("es", {
    edits: [{ kind: "product", id: "two", expected: "baseline-two", text: "Pan" }],
})
```

Current checks:

```text
430: expect(note(el, "s1")).toBeNull()
433: expect(bar(el).error).toBe(codeMessage("server.internal"))
435: expect(field(el, "one")!.value).toBe("")
436: expect(field(el, "one", "en")!.value).toBe("CLIENT-en one")
438: expect(el.open).toBe(false)
439: expect(api.saveContentTranslations).toHaveBeenCalledExactlyOnceWith({
    edits: [submitted("one", "CLIENT-en one", "en"), submitted("two", "Pan")],
})
```

##### a Discard refused after another of the row's suggestions was deleted keeps the row empty through later reads${refresh ? ", with a refresh between the two deletions" : ""}

Old `content-translations-dialog.drafts.test.ts:318` → current `:444`: `a failed second per-id Discard retains only its own borrowed text, refresh=${refresh}`. Authority: Task10/11 and the relevant replacement category above.

Old checks:

```text
343: expect(field(el, "one")!.value).toBe("CLIENT-es one")
344: expect(q(el, "[data-test=fix-product-one-es]")).not.toBeNull()
346: expect(api.discardContentSuggestion).toHaveBeenCalledWith("s1")
349: expect(q(el, "[data-test=fix-product-one-es]")).toBeNull()
350: expect(field(el, "one")!.value).toBe("CLIENT-es one")
353: expect(bottomMessage(el)).toBe(codeMessage("server.internal"))
355: expect(field(el, "one")!.value).toBe("")
356: expect(q(el, "[data-test=suggested-product-one]")).toBeNull()
357: expect(q(el, "[data-test=discard-product-one]")).toBeNull()
358: expect(save(el).disabled).toBe(true)
361: expect(field(el, "two")!.value).toBe("CLIENT-es two")
362: expect(field(el, "one")!.value).toBe("")
364: expect(el.open).toBe(false)
365: expect(api.saveContentTranslations).toHaveBeenCalledExactlyOnceWith("es", {
    edits: [{ kind: "product", id: "two", expected: "baseline-two", text: "CLIENT-es two" }],
})
```

Current checks:

```text
469: expect(note(el, "s0")).toBeNull()
474: expect(api.getContentSuggestions.mock.calls.length).toBeGreaterThan(1)
482: expect(bar(el).error).toBe(codeMessage("server.internal"))
483: expect(field(el, "one")!.value).toBe("CLIENT-es one")
484: expect(save(el).disabled).toBe(false)
487: expect(field(el, "two")!.value).toBe("CLIENT-es two")
489: expect(el.open).toBe(false)
490: expect(api.saveContentTranslations).toHaveBeenCalledExactlyOnceWith({
    edits: [submitted("one", "CLIENT-es one"), submitted("two", "CLIENT-es two")],
})
```

##### Discard takes the suggestion's untouched field out of a person's edit, so Save sends only what they typed

Old `content-translations-dialog.drafts.test.ts:369` → current `:495`: `Discard preserves personal ${typed} and saves it without a required companion`. Authority: Task10/11 and the relevant replacement category above.

Old checks:

```text
383: expect(q(el, "[data-test=discard-product-one]")).toBeNull()
384: expect(field(el, "one", typed)!.value).toBe("Mine")
385: expect(field(el, "one", other)!.value).toBe("")
387: expect(api.saveContentTranslations).not.toHaveBeenCalled()
388: expect(field(el, "one", other)!.error).toBe(t("translations.required"))
391: expect(el.open).toBe(false)
392: expect(api.saveContentTranslations).toHaveBeenCalledExactlyOnceWith("es", {
    edits: [
        {
            kind: "product",
            id: "one",
            expected: "baseline-one",
            text: typed === "text" ? "Mine" : "Also mine",
            defaultText: typed === "text" ? "Also mine" : "Mine",
        },
    ],
})
```

Current checks:

```text
507: expect(note(el, "s1")).toBeNull()
509: expect(note(el, "s2")).toBeNull()
510: expect(field(el, "one", typed)!.value).toBe("Mine")
511: expect(field(el, "one", typed === "es" ? "en" : "es")!.value).toBe("")
513: expect(el.open).toBe(false)
514: expect(api.saveContentTranslations).toHaveBeenCalledExactlyOnceWith({
    edits: [submitted("one", "Mine", typed)],
})
```

##### Discard takes the untouched companion out of a person's edit even when a refresh lands between the row's two deletions

Old `content-translations-dialog.drafts.test.ts:406` → current `:518`: Discard removes borrowed default text through a refresh while preserving a personal other language. Authority: Task10/11 and the relevant replacement category above.

Old checks:

```text
427: expect(api.discardContentSuggestion).toHaveBeenCalledWith("s2")
429: expect(q(el, "[data-test=discard-product-one]")).toBeNull()
433: expect(field(el, "one")!.value).toBe("Mine")
434: expect(field(el, "one", "defaultText")!.value).toBe("")
436: expect(api.saveContentTranslations).not.toHaveBeenCalled()
439: expect(el.open).toBe(false)
440: expect(api.saveContentTranslations).toHaveBeenCalledExactlyOnceWith("es", {
    edits: [
        {
            kind: "product",
            id: "one",
            expected: "baseline-one",
            text: "Mine",
            defaultText: "Also mine",
        },
    ],
})
```

Current checks:

```text
540: expect(api.getContentSuggestions.mock.calls.length).toBeGreaterThan(1)
543: expect(field(el, "one")!.value).toBe("Mine")
544: expect(field(el, "one", "en")!.value).toBe("")
546: expect(el.open).toBe(false)
547: expect(api.saveContentTranslations).toHaveBeenCalledExactlyOnceWith({
    edits: [submitted("one", "Mine")],
})
```

##### a Discard refused after another of the row's suggestions was deleted takes the suggested name back out of an edit whose companion was typed while it waited${refresh ? ", after a refresh between the two deletions" : ""}

Old `content-translations-dialog.drafts.test.ts:453` → current `:552`: `a failed Discard retains the other suggestion when its default is typed while waiting, refresh=${refresh}`. Authority: Task10/11 and the relevant replacement category above.

Old checks:

```text
480: expect(api.discardContentSuggestion).toHaveBeenCalledWith("s1")
483: expect(q(el, "[data-test=fix-product-one-es]")).toBeNull()
487: expect(bottomMessage(el)).toBe(codeMessage("server.internal"))
489: expect(field(el, "one")!.value).toBe("")
490: expect(field(el, "one", "defaultText")!.value).toBe("Mine")
492: expect(field(el, "one")!.error).toBe(t("translations.required"))
493: expect(api.saveContentTranslations).not.toHaveBeenCalled()
```

Current checks:

```text
578: expect(note(el, "s0")).toBeNull()
583: expect(api.getContentSuggestions.mock.calls.length).toBeGreaterThan(1)
592: expect(field(el, "one")!.value).toBe("CLIENT-es one")
593: expect(field(el, "one", "en")!.value).toBe("Mine")
594: expect(bar(el).error).toBe(codeMessage("server.internal"))
596: expect(el.open).toBe(false)
597: expect(api.saveContentTranslations).toHaveBeenCalledExactlyOnceWith({
    edits: [submitted("one", "CLIENT-es one"), submitted("one", "Mine", "en")],
})
```

##### Discard sends once while its own request or a save is being sent

Old `content-translations-dialog.drafts.test.ts:495` → current `:601`: Discard sends once while its own request or a save is being sent. Authority: Task10/11 and the relevant replacement category above.

Old checks:

```text
510: expect(q<HTMLElementTagNameMap["wt-button"]>(el, "[data-test=discard-product-one]")!.disabled).toBe(true)
514: expect(api.discardContentSuggestion).toHaveBeenCalledTimes(1)
516: expect(field(el, "one")!.value).toBe("")
518: expect(api.saveContentTranslations).toHaveBeenCalled()
520: expect(api.discardContentSuggestion).toHaveBeenCalledTimes(1)
```

Current checks:

```text
618: expect(discardButton(el, "s1")!.disabled).toBe(true)
620: expect(api.discardContentSuggestion).toHaveBeenCalledTimes(1)
623: expect(field(el, "one")!.value).toBe("")
626: expect(api.discardContentSuggestion).toHaveBeenCalledTimes(1)
```

##### a Discard unanswered across closing and reopening keeps the reopened row's Discard and Save waiting, and once it deletes the suggestion Save leaves it out

Old `content-translations-dialog.drafts.test.ts:522` → current `:628`: a Discard unanswered across reopening keeps Discard and Save waiting and then leaves the deleted value out. Authority: Task10/11 and the relevant replacement category above.

Old checks:

```text
543: expect(field(el, "one")?.value).toBe("CLIENT-es one")
545: expect(q<HTMLElementTagNameMap["wt-button"]>(el, "[data-test=discard-product-one]")!.disabled).toBe(true)
548: expect(save(el).disabled).toBe(true)
551: expect(api.discardContentSuggestion).toHaveBeenCalledTimes(1)
552: expect(api.saveContentTranslations).not.toHaveBeenCalled()
554: expect(field(el, "one")!.value).toBe("")
555: expect(q(el, "[data-test=suggested-product-one]")).toBeNull()
556: expect(save(el).disabled).toBe(false)
558: expect(el.open).toBe(false)
559: expect(api.saveContentTranslations).toHaveBeenCalledExactlyOnceWith("es", {
    edits: [{ kind: "product", id: "two", expected: "baseline-two", text: "Pan" }],
})
```

Current checks:

```text
645: expect(discardButton(el, "s1")!.disabled).toBe(true)
646: expect(save(el).disabled).toBe(true)
649: expect(api.discardContentSuggestion).toHaveBeenCalledTimes(1)
650: expect(api.saveContentTranslations).not.toHaveBeenCalled()
653: expect(field(el, "one")!.value).toBe("")
654: expect(note(el, "s1")).toBeNull()
655: expect(save(el).disabled).toBe(false)
657: expect(el.open).toBe(false)
658: expect(api.saveContentTranslations).toHaveBeenCalledExactlyOnceWith({
    edits: [submitted("two", "Pan")],
})
```

##### a suggestion read begun before a Discard deleted that suggestion does not fill the reopened row

Old `content-translations-dialog.drafts.test.ts:563` → current `:662`: a suggestion read begun before Discard does not fill the reopened row after deletion. Authority: Task10/11 and the relevant replacement category above.

Old checks:

```text
594: expect(api.getContentSuggestions.mock.calls.length).toBeGreaterThanOrEqual(reads + 2)
599: expect(field(el, "one")).not.toBeNull()
601: expect(field(el, "one")!.value).toBe("")
602: expect(q(el, "[data-test=suggested-product-one]")).toBeNull()
605: expect(el.open).toBe(false)
606: expect(api.saveContentTranslations).toHaveBeenCalledExactlyOnceWith("es", {
    edits: [{ kind: "product", id: "two", expected: "baseline-two", text: "Pan" }],
})
```

Current checks:

```text
690: expect(api.getContentSuggestions.mock.calls.length).toBeGreaterThan(reads)
697: expect(field(el, "one")!.value).toBe("")
698: expect(note(el, "s1")).toBeNull()
701: expect(el.open).toBe(false)
702: expect(api.saveContentTranslations).toHaveBeenCalledExactlyOnceWith({
    edits: [submitted("two", "Pan")],
})
```

##### a Discard refused after the dialog was closed and reopened leaves the reopened row's suggestion usable and shows no refusal there

Old `content-translations-dialog.drafts.test.ts:610` → current `:738`: a Discard refused after reopening leaves the suggestion usable and shows no old refusal. Authority: Task10/11 and the relevant replacement category above.

Old checks:

```text
627: expect(field(el, "one")?.value).toBe("CLIENT-es one")
630: expect(q<HTMLElementTagNameMap["wt-button"]>(el, "[data-test=discard-product-one]")!.disabled).toBe(false)
634: expect(field(el, "one")!.value).toBe("CLIENT-es one")
635: expect(q(el, "[data-test=suggested-product-one]")).not.toBeNull()
636: expect(bottomMessage(el)).toBe("")
638: expect(el.open).toBe(false)
639: expect(api.saveContentTranslations).toHaveBeenCalledExactlyOnceWith("es", {
    edits: [{ kind: "product", id: "one", expected: "baseline-one", text: "CLIENT-es one" }],
})
```

Current checks:

```text
757: expect(discardButton(el, "s1")!.disabled).toBe(false)
758: expect(field(el, "one")!.value).toBe("CLIENT-es one")
759: expect(bar(el).error).toBe("")
760: expect(bottomMessage(el)).toBe("")
762: expect(el.open).toBe(false)
763: expect(api.saveContentTranslations).toHaveBeenCalledExactlyOnceWith({
    edits: [submitted("one", "CLIENT-es one")],
})
```

##### a Discard refused after another of the row's suggestions was deleted, answered before the reopened dialog's first read, leaves the reopened row empty, and the opening after that fills it again

Old `content-translations-dialog.drafts.test.ts:643` → current `:767`: a failed independent deletion answered before the reopened first read preserves the still-stored suggestion. Authority: Task10/11 and the relevant replacement category above.

Old checks:

```text
663: expect(api.discardContentSuggestion).toHaveBeenCalledWith("s1")
677: expect(api.getContentSuggestions.mock.calls.length).toBeGreaterThanOrEqual(reads + 2)
680: expect(api.discardContentSuggestion.mock.results[1]!.value).rejects.toEqual({
    code: "server.internal",
})
684: expect(field(el, "one")).not.toBeNull()
686: expect(field(el, "one")!.value).toBe("")
687: expect(q(el, "[data-test=suggested-product-one]")).toBeNull()
688: expect(save(el).disabled).toBe(true)
691: expect(el.open).toBe(false)
692: expect(api.saveContentTranslations).toHaveBeenCalledExactlyOnceWith("es", {
    edits: [{ kind: "product", id: "two", expected: "baseline-two", text: "Pan" }],
})
696: expect(field(el, "one")?.value).toBe("CLIENT-es one")
697: expect(q(el, "[data-test=discard-product-one]")).not.toBeNull()
```

Current checks:

```text
786: expect(note(el, "s0")).toBeNull()
801: expect(api.getContentSuggestions.mock.calls.length).toBeGreaterThan(reads)
811: expect(field(el, "one")!.value).toBe("CLIENT-es one")
812: expect(note(el, "s0")).toBeNull()
813: expect(bar(el).error).toBe("")
814: expect(save(el).disabled).toBe(false)
816: expect(field(el, "one")!.value).toBe("CLIENT-es one")
```

##### a Discard on the Spanish page refused after the dialog reopened on French leaves the French row's suggestion usable${beforeRead ? ", answered before the French page's first read" : ""}

Old `content-translations-dialog.drafts.test.ts:700` → current `:819`: `a refused Spanish Discard does not remove French after reopening, beforeRead=${beforeRead}`. Authority: Task10/11 and the relevant replacement category above.

Old checks:

```text
725: expect(api.discardContentSuggestion).toHaveBeenCalledWith("s2")
747: expect(reopenedRead).toBe(true)
748: expect(field(el, "one")?.value).toBe("CLIENT-fr one")
750: expect(api.discardContentSuggestion.mock.results[1]!.value).rejects.toEqual({
    code: "server.internal",
})
755: expect(q<HTMLElementTagNameMap["wt-button"]>(el, "[data-test=discard-product-one]")?.disabled).toBe(false)
759: expect(field(el, "one")!.value).toBe("CLIENT-fr one")
760: expect(q(el, "[data-test=suggested-product-one]")).not.toBeNull()
762: expect(el.open).toBe(false)
763: expect(api.saveContentTranslations).toHaveBeenCalledExactlyOnceWith("fr", {
    edits: [{ kind: "product", id: "one", expected: "baseline-one", text: "CLIENT-fr one" }],
})
```

Current checks:

```text
851: expect(api.getContentSuggestions.mock.calls.length).toBeGreaterThan(reads)
862: expect(field(el, "one", "fr")!.value).toBe("CLIENT-fr one")
863: expect(field(el, "one", "es")!.value).toBe("CLIENT-es one")
864: expect(bar(el).error).toBe("")
865: expect(discardButton(el, "s1")!.disabled).toBe(false)
867: expect(el.open).toBe(false)
868: expect(api.saveContentTranslations).toHaveBeenCalledExactlyOnceWith({
    edits: [submitted("one", "CLIENT-es one"), submitted("one", "CLIENT-fr one", "fr")],
})
```

##### a Discard on the Spanish page refused while the French page was open does not empty the row at the next Spanish opening${beforeRead ? ", answered before the French page's first read" : ""}

Old `content-translations-dialog.drafts.test.ts:768` → current `:873`: `an earlier deleted note and refused Spanish deletion do not suppress later Spanish reopening, beforeRead=${beforeRead}`. Authority: Task10/11 and the relevant replacement category above.

Old checks:

```text
797: expect(api.discardContentSuggestion).toHaveBeenCalledWith("s2")
820: expect(reopenedRead).toBe(true)
821: expect(field(el, "one")?.value).toBe("CLIENT-fr one")
823: expect(api.discardContentSuggestion.mock.results[1]!.value).rejects.toEqual({
    code: "server.internal",
})
827: expect(field(el, "one")?.value).toBe("CLIENT-fr one")
834: expect(field(el, "one")?.value).toBe("CLIENT-es one")
835: expect(q(el, "[data-test=suggested-product-one]")).not.toBeNull()
836: expect(q(el, "[data-test=fix-product-one-internal]")).not.toBeNull()
837: expect(q<HTMLElementTagNameMap["wt-button"]>(el, "[data-test=discard-product-one]")!.disabled).toBe(false)
841: expect(el.open).toBe(false)
842: expect(api.saveContentTranslations).toHaveBeenCalledExactlyOnceWith("es", {
    edits: [{ kind: "product", id: "one", expected: "baseline-one", text: "CLIENT-es one" }],
})
```

Current checks:

```text
898: expect(note(el, "s0")).toBeNull()
917: expect(api.getContentSuggestions.mock.calls.length).toBeGreaterThan(reads)
929: expect(field(el, "one")!.value).toBe("CLIENT-es one")
930: expect(note(el, "s0")).toBeNull()
931: expect(note(el, "s2")!.textContent).toContain("ZURRITO")
932: expect(discardButton(el, "s1")!.disabled).toBe(false)
934: expect(el.open).toBe(false)
935: expect(api.saveContentTranslations).toHaveBeenCalledExactlyOnceWith({
    edits: [submitted("one", "CLIENT-es one"), submitted("one", "CLIENT-fr one", "fr")],
})
```

##### Save waits while a Discard is being sent, so it never sends the suggestion being discarded

Old `content-translations-dialog.drafts.test.ts:846` → current `:939`: Save waits for Discard and never sends the value being discarded. Authority: Task10/11 and the relevant replacement category above.

Old checks:

```text
858: expect(save(el).disabled).toBe(true)
860: expect(api.saveContentTranslations).not.toHaveBeenCalled()
862: expect(save(el).disabled).toBe(false)
864: expect(el.open).toBe(false)
865: expect(api.saveContentTranslations).toHaveBeenCalledExactlyOnceWith("es", {
    edits: [{ kind: "product", id: "two", expected: "baseline-two", text: "Pan" }],
})
```

Current checks:

```text
953: expect(save(el).disabled).toBe(true)
955: expect(api.saveContentTranslations).not.toHaveBeenCalled()
958: expect(save(el).disabled).toBe(false)
960: expect(el.open).toBe(false)
961: expect(api.saveContentTranslations).toHaveBeenCalledExactlyOnceWith({
    edits: [submitted("two", "Pan")],
})
```

##### a Discard unanswered while the dialog is taken out and put back keeps Save waiting, and once answered Save leaves the suggestion out

Old `content-translations-dialog.drafts.test.ts:869` → current `:965`: a Discard unanswered across disconnect and reconnect keeps Save waiting and excludes the deleted value. Authority: Task10/11 and the relevant replacement category above.

Old checks:

```text
893: expect(api.getContentTranslationTargets.mock.calls.length).toBeGreaterThan(reads)
896: expect(q<HTMLElementTagNameMap["wt-button"]>(el, "[data-test=discard-product-one]")!.disabled).toBe(true)
899: expect(save(el).disabled).toBe(true)
901: expect(api.saveContentTranslations).not.toHaveBeenCalled()
903: expect(field(el, "one")!.value).toBe("")
905: expect(el.open).toBe(false)
906: expect(api.saveContentTranslations).toHaveBeenCalledExactlyOnceWith("es", {
    edits: [{ kind: "product", id: "two", expected: "baseline-two", text: "Pan" }],
})
```

Current checks:

```text
986: expect(api.getContentTranslationTargets.mock.calls.length).toBeGreaterThan(reads)
989: expect(discardButton(el, "s1")!.disabled).toBe(true)
990: expect(save(el).disabled).toBe(true)
992: expect(api.saveContentTranslations).not.toHaveBeenCalled()
995: expect(field(el, "one")!.value).toBe("")
997: expect(el.open).toBe(false)
998: expect(api.saveContentTranslations).toHaveBeenCalledExactlyOnceWith({
    edits: [submitted("two", "Pan")],
})
```

##### a scan replaced while it reads suggestion pages stops reading them

Old `content-translations-dialog.drafts.test.ts:910` → current `:1002`: a closed editor ignores the pending explicitly requested suggestion page and does not drain the next one. Authority: Task10/11 and the relevant replacement category above.

Old checks:

```text
930: expect(api.getContentSuggestions).toHaveBeenCalledWith({
    after: "1",
    configuration: "suggestion-config",
})
942: expect(api.getContentSuggestions).not.toHaveBeenCalledWith({
    after: "2",
    configuration: "suggestion-config",
})
```

Current checks:

```text
1020: expect(api.getContentSuggestions).toHaveBeenCalledWith({
    after: "1",
    configuration: "configuration-one",
})
1029: expect(el.open).toBe(false)
1030: expect(api.getContentSuggestions).not.toHaveBeenCalledWith({
    after: "2",
    configuration: "configuration-one",
})
```

##### a stale refusal on save empties that suggested row and keeps the others

Old `content-translations-dialog.drafts.test.ts:947` → current `:1035`: a stale save refusal identifies exactly its language field and retains the other drafts. Authority: Task10/11 and the relevant replacement category above.

Old checks:

```text
960: expect(bottomMessage(el)).toContain(codeMessage("content.translation_stale"))
962: expect(field(el, "two")!.value).toBe("")
963: expect(q(el, "[data-test=suggested-product-two]")).toBeNull()
964: expect(field(el, "one")!.value).toBe("CLIENT-es one")
966: expect(el.open).toBe(false)
967: expect(api.saveContentTranslations).toHaveBeenLastCalledWith("es", {
    edits: [{ kind: "product", id: "one", expected: "baseline-one", text: "CLIENT-es one" }],
})
```

Current checks:

```text
1048: expect(field(el, "two")!.error).toBe(codeMessage("content.translation_stale"))
1050: expect(field(el, "one")!.value).toBe("CLIENT-es one")
1051: expect(field(el, "two")!.value).toBe("CLIENT-es two")
1052: expect(save(el).disabled).toBe(false)
1054: expect(el.open).toBe(false)
1055: expect(api.saveContentTranslations).toHaveBeenLastCalledWith({
    edits: [submitted("one", "CLIENT-es one"), submitted("two", "CLIENT-es two")],
})
```

##### a suggestion arriving while the dialog is open fills an untouched row and leaves a typed one

Old `content-translations-dialog.drafts.test.ts:971` → current `:1059`: live suggestions fill untouched fields and leave personal values. Authority: Task10/11 and the relevant replacement category above.

Old checks:

```text
980: expect(api.getContentTranslationTargets.mock.calls.length).toBeGreaterThan(reads)
982: expect(field(el, "two")!.value).toBe("CLIENT-es two")
983: expect(field(el, "one")!.value).toBe("Mine")
```

Current checks:

```text
1066: expect(field(el, "two")!.value).toBe("CLIENT-es two")
1067: expect(field(el, "one")!.value).toBe("Mine")
```

##### a refused suggestion read keeps the translations usable and tells the refusal in the bar

Old `content-translations-dialog.drafts.test.ts:985` → current `:1069`: a refused suggestion read leaves translations usable and reports in the bar. Authority: Task10/11 and the relevant replacement category above.

Old checks:

```text
994: expect(bar.error).toBe(codeMessage("cloud.state_invalid"))
995: expect(q(el, "[data-test=read-error]")).toBeNull()
996: expect(q(el, "wt-data-table")).not.toBeNull()
999: expect(el.open).toBe(false)
1000: expect(api.saveContentTranslations).toHaveBeenCalledExactlyOnceWith("es", {
    edits: [{ kind: "product", id: "one", expected: "baseline-one", text: "Pan" }],
})
```

Current checks:

```text
1075: expect(bar(el).error).toBe(codeMessage("cloud.state_invalid"))
1076: expect(q(el, "[data-test=read-error]")).toBeNull()
1077: expect(field(el, "one")).not.toBeNull()
1080: expect(el.open).toBe(false)
1081: expect(api.saveContentTranslations).toHaveBeenCalledExactlyOnceWith({
    edits: [submitted("one", "Pan")],
})
```

##### a refused later suggestion page is told in the bar while the translations load, and clears once a scan reads every page

Old `content-translations-dialog.drafts.test.ts:1004` → current `:1085`: a refused requested continuation reports in the bar and recovers on explicit retry. Authority: Task10/11 and the relevant replacement category above.

Old checks:

```text
1030: expect(await barText()).toContain(codeMessage("cloud.unavailable"))
1032: expect(q(el, "[data-test=read-error]")).toBeNull()
1033: expect(field(el, "one")!.value).toBe("")
1034: expect(field(el, "two")!.value).toBe("")
1038: expect(api.getContentSuggestions.mock.calls.length).toBeGreaterThan(firstPageReads)
1041: expect(await barText()).toContain(codeMessage("cloud.unavailable"))
1044: expect(field(el, "two")!.value).toBe("CLIENT-es two")
1045: expect(await barText()).not.toContain(codeMessage("cloud.unavailable"))
```

Current checks:

```text
1100: expect(bar(el).error).toBe(codeMessage("cloud.unavailable"))
1101: expect(field(el, "one")!.value).toBe("CLIENT-es one")
1102: expect(field(el, "two")!.value).toBe("")
1103: expect(q(el, "[data-test=read-error]")).toBeNull()
1106: expect(bar(el).error).toBe(codeMessage("cloud.unavailable"))
1109: expect(field(el, "two")!.value).toBe("CLIENT-es two")
1110: expect(bar(el).error).toBe("")
```

##### Review latest tells a refused later suggestion page in the bar

Old `content-translations-dialog.drafts.test.ts:1047` → current `:1112`: Review latest retains continuation drafts while a requested later page refuses. Authority: Task10/11 and the relevant replacement category above.

Old checks:

```text
1066: expect(bar.error).toBe("")
1069: expect(bar.error).toBe(codeMessage("cloud.unavailable"))
1070: expect(field(el, "two")!.value).toBe("CLIENT-es two")
```

Current checks:

```text
1127: expect(field(el, "two")!.value).toBe("CLIENT-es two")
1130: expect(api.getContentSuggestions).toHaveBeenCalledTimes(reads)
1133: expect(bar(el).error).toBe(codeMessage("cloud.unavailable"))
1134: expect(field(el, "two")!.value).toBe("CLIENT-es two")
1135: expect(field(el, "three")!.value).toBe("")
```

##### reopening forgets a refused later suggestion page while the new opening reads

Old `content-translations-dialog.drafts.test.ts:1072` → current `:1137`: reopening forgets an old continuation refusal while its new first read waits. Authority: Task10/11 and the relevant replacement category above.

Old checks:

```text
1090: expect(bar.error).toBe(codeMessage("cloud.unavailable"))
1097: expect(api.getContentSuggestions.mock.calls
    .slice(reads)
    .some(([query]) => query?.after !== undefined)).toBe(true)
1105: expect(bar.error).toBe("")
```

Current checks:

```text
1151: expect(bar(el).error).toBe(codeMessage("cloud.unavailable"))
1163: expect(api.getContentSuggestions.mock.calls.length).toBeGreaterThan(reads)
1166: expect(bar(el).error).toBe("")
1170: expect(field(el, "one")!.value).toBe("CLIENT-es one")
```

##### a suggestion page with the viewed language disabled, or one that repeats its cursor, fills nothing

Old `content-translations-dialog.drafts.test.ts:1107` → current `:1172`: a changed configuration or repeated continuation cursor never borrows that page. Authority: Task10/11 and the relevant replacement category above.

Old checks:

```text
1124: expect(q(el, "[data-test=read-error]")).toBeNull()
1125: expect(field(el, "one")!.value).toBe("")
1126: expect(api.getContentSuggestions).toHaveBeenCalled()
```

Current checks:

```text
1197: expect(bar(el).error).not.toBe("")
1198: expect(field(el, "one")!.value).toBe("CLIENT-es one")
1199: expect(field(el, "two")!.value).toBe("")
1200: expect(q(el, "[data-test=read-error]")).toBeNull()
1201: expect(api.getContentSuggestions).toHaveBeenCalledTimes(2)
```

##### a suggestion read refused after a good one keeps the suggestions already filled

Old `content-translations-dialog.drafts.test.ts:1130` → current `:1205`: a later refused suggestion refresh keeps already borrowed text. Authority: Task10/11 and the relevant replacement category above.

Old checks:

```text
1140: expect(q(el, "[data-test=arrivals]")).not.toBeNull()
1141: expect(field(el, "one")!.value).toBe("CLIENT-es one")
1142: expect(q(el, "[data-test=suggested-product-one]")).not.toBeNull()
1143: expect(q(el, "[data-test=read-error]")).toBeNull()
```

Current checks:

```text
1215: expect(bar(el).error).toBe(codeMessage("cloud.state_invalid"))
1216: expect(field(el, "one")!.value).toBe("CLIENT-es one")
1217: expect(note(el, "s1")!.textContent).toContain(t("suggestions.suggested"))
1218: expect(q(el, "[data-test=read-error]")).toBeNull()
```

##### shows a placeholder's note, fills nothing and offers Discard

Old `content-translations-dialog.drafts.test.ts:1148` → current `:1222`: shows a placeholder note, fills nothing and offers Discard. Authority: Task10/11 and the relevant replacement category above.

Old checks:

```text
1155: expect(q(el, "[data-test=placeholder-product-one]")!.textContent!.trim()).toBe(t("suggestions.placeholder"))
1158: expect(field(el, "one")!.value).toBe("")
1159: expect(q(el, "[data-test=suggested-product-one]")).toBeNull()
1160: expect(q(el, "[data-test=discard-product-one]")).not.toBeNull()
1161: expect(save(el).disabled).toBe(true)
```

Current checks:

```text
1229: expect(note(el, "s1")!.textContent).toContain(t("suggestions.placeholder"))
1230: expect(field(el, "one")!.value).toBe("")
1231: expect(note(el, "s1")!.textContent).not.toContain(t("suggestions.suggested"))
1232: expect(discardButton(el, "s1")).not.toBeNull()
1233: expect(save(el).disabled).toBe(true)
```

##### shows a spelling fix to the internal name beside the editor link, and still fills

Old `content-translations-dialog.drafts.test.ts:1163` → current `:1235`: shows an internal spelling fix with its editor link while the other suggestion fills. Authority: Task10/11 and the relevant replacement category above.

Old checks:

```text
1177: expect(q(el, "[data-test=fix-product-one-internal]")!.textContent!.trim()).toBe(fill("suggestions.fix_internal", { wrong: "ZURRITO", right: "ZURITO" }))
1180: expect(field(el, "one")!.value).toBe("CLIENT-es one")
1182: expect(row.querySelector("a")!.getAttribute("href")).toBe("/manage/catalogue/product/one")
```

Current checks:

```text
1249: expect(note(el, "s2")!.textContent).toContain(fill("suggestions.fix_internal", { wrong: "ZURRITO", right: "ZURITO" }))
1252: expect(field(el, "one")!.value).toBe("CLIENT-es one")
1253: expect(note(el, "s2")!.querySelector("a")!.getAttribute("href")).toBe("/manage/catalogue/product/one")
1256: expect(note(el, "s2")!.querySelector("[data-test=use-fix]")).toBeNull()
```

##### shows a fix to a name entered in another language as a note naming that language

Old `content-translations-dialog.drafts.test.ts:1184` → current `:1258`: names the language of a spelling fix and waits for Use fix. Authority: Task10/11 and the relevant replacement category above.

Old checks:

```text
1197: expect(q(el, "[data-test=fix-product-one-en]")!.textContent!.trim()).toBe(fill("suggestions.fix_language", {
    language: languageDisplayName("en", currentLocale(), false),
    wrong: "Croquetes",
    right: "Croquettes",
}))
1204: expect(field(el, "one")!.value).toBe("")
```

Current checks:

```text
1275: expect(note(el, "s1")!.textContent).toContain(fill("suggestions.fix_language", {
    language: languageDisplayName("en", currentLocale()),
    wrong: "Croquetes",
    right: "Croquettes",
}))
1282: expect(field(el, "one", "en")!.value).toBe("Croquetes")
1283: expect(save(el).disabled).toBe(true)
```

##### shows an out-of-date suggestion's note and fills nothing, as after a stale refusal

Old `content-translations-dialog.drafts.test.ts:1206` → current `:1285`: shows stale notes without borrowing and keeps a stale save refusal field-specific. Authority: Task10/11 and the relevant replacement category above.

Old checks:

```text
1213: expect(q(el, "[data-test=stale-product-one]")!.textContent!.trim()).toBe(t("suggestions.stale"))
1216: expect(field(el, "one")!.value).toBe("")
1222: expect(q(el, "[data-test=stale-product-two]")).not.toBeNull()
```

Current checks:

```text
1292: expect(note(el, "s1")!.textContent).toContain(t("suggestions.stale"))
1293: expect(field(el, "one")!.value).toBe("")
1300: expect(field(el, "two")!.error).toBe(codeMessage("content.translation_stale"))
1302: expect(field(el, "two")!.value).toBe("CLIENT-es two")
1303: expect(save(el).disabled).toBe(false)
```

##### shows a one-language venue's suggestion for an empty name and saves it

Old `content-translations-dialog.drafts.test.ts:1235` → current `:1316`: retains a one-language off-page suggestion, reveals it through Show staged and saves it. Authority: Task10/11 and the relevant replacement category above.

Old checks:

```text
1237: expect(api.getContentTranslationTargets).toHaveBeenCalledWith("ca", {
    targets: [{ kind: "product", id: "empty" }],
})
1240: expect(field(el, "empty")!.value).toBe("CLIENT-ca Croquetes")
1241: expect(q(el, "[data-test=suggested-product-empty]")).not.toBeNull()
1242: expect(q(el, "[data-test=complete]")).toBeNull()
1244: expect(el.open).toBe(false)
1245: expect(api.saveContentTranslations).toHaveBeenCalledExactlyOnceWith("ca", {
    edits: [
        { kind: "product", id: "empty", expected: "baseline-empty", text: "CLIENT-ca Croquetes" },
    ],
})
```

Current checks:

```text
1318: expect(api.getContentTranslationCells).toHaveBeenCalledExactlyOnceWith([
    { kind: "product", id: "empty", language: "ca", field: "name" },
])
1321: expect(field(el, "empty")).toBeNull()
1322: expect(note(el, "s1")!.textContent).toContain(t("suggestions.suggested"))
1324: expect(field(el, "empty")!.value).toBe("CLIENT-ca Croquetes")
1325: expect(q(el, "[data-test=complete]")).toBeNull()
1327: expect(el.open).toBe(false)
1328: expect(api.saveContentTranslations).toHaveBeenCalledExactlyOnceWith({
    edits: [submitted("empty", "CLIENT-ca Croquetes", "ca")],
})
```

##### keeps a page-omitted suggested row through a live refresh

Old `content-translations-dialog.drafts.test.ts:1251` → current `:1332`: retains an off-page suggestion through live refresh. Authority: Task10/11 and the relevant replacement category above.

Old checks:

```text
1257: expect(api.getContentTranslationTargets.mock.calls.length).toBeGreaterThanOrEqual(reads + 2)
1260: expect(field(el, "empty")!.value).toBe("CLIENT-ca Croquetes")
1261: expect(q(el, "[data-test=suggested-product-empty]")).not.toBeNull()
```

Current checks:

```text
1338: expect(api.getContentTranslationTargets.mock.calls.length).toBeGreaterThan(reads)
1341: expect(field(el, "empty")!.value).toBe("CLIENT-ca Croquetes")
1342: expect(note(el, "s1")!.textContent).toContain(t("suggestions.suggested"))
```

##### leaves out an omitted item that is gone, named since, or whose suggestion is out of date

Old `content-translations-dialog.drafts.test.ts:1263` → current `:1344`: does not stage gone, already named or stale off-page suggestions. Authority: Task10/11 and the relevant replacement category above.

Old checks:

```text
1278: expect(api.getContentTranslationTargets).toHaveBeenCalledWith("ca", {
    targets: [
        { kind: "product", id: "gone" },
        { kind: "product", id: "named" },
    ],
})
1284: expect(q(el, "[data-test=complete]")).not.toBeNull()
```

Current checks:

```text
1359: expect(api.getContentTranslationCells).toHaveBeenCalledExactlyOnceWith([
    { kind: "product", id: "gone", language: "ca", field: "name" },
    { kind: "product", id: "named", language: "ca", field: "name" },
])
1363: expect(q(el, "[data-test=complete]")).not.toBeNull()
1364: expect(save(el).disabled).toBe(true)
1365: expect(q(el, "[data-test=edited-count]")!.textContent).toContain("0")
```

##### reads omitted items fifty at a time

Old `content-translations-dialog.drafts.test.ts:1286` → current `:1367`: reads at most one hundred retained cells and reveals fifty distinct items at a time. Authority: Task10/11 and the relevant replacement category above.

Old checks:

```text
1299: expect(sizes).toEqual([50, 10])
1300: expect(field(el, "e00")!.value).toBe("CLIENT-ca e00")
```

Current checks:

```text
1377: expect(api.getContentTranslationCells.mock.calls.map(([refs]) => refs.length)).toEqual([60])
1378: expect(api.getContentTranslationTargets).toHaveBeenCalledTimes(1)
1380: expect(field(el, "e00")!.value).toBe("CLIENT-ca e00")
1381: expect(field(el, "e50")).toBeNull()
1383: expect(field(el, "e50")!.value).toBe("CLIENT-ca e50")
1384: expect(field(el, "e59")!.value).toBe("CLIENT-ca e59")
1385: expect(field(el, "e00")).toBeNull()
```

##### shows a placeholder or a staff-name fix for an item the default-language page leaves out, with its Discard

Old `content-translations-dialog.drafts.test.ts:1302` → current `:1387`: shows off-page placeholder and internal-fix notes with Discard without loading item pages. Authority: Task10/11 and the relevant replacement category above.

Old checks:

```text
1317: expect(q(el, "[data-test=placeholder-product-empty]")!.textContent!.trim()).toBe(t("suggestions.placeholder"))
1320: expect(q(el, "[data-test=fix-product-typo-internal]")!.textContent!.trim()).toBe(fill("suggestions.fix_internal", { wrong: "ZURRITO", right: "ZURITO" }))
1323: expect(field(el, "empty")!.value).toBe("")
1324: expect(field(el, "typo")!.value).toBe("")
1325: expect(q(el, "[data-test=suggested-product-empty]")).toBeNull()
1326: expect(save(el).disabled).toBe(true)
1328: expect(api.discardContentSuggestion).toHaveBeenCalledWith("s1")
1329: expect(q(el, "[data-test=placeholder-product-empty]")).toBeNull()
```

Current checks:

```text
1402: expect(note(el, "s1")!.textContent).toContain(t("suggestions.placeholder"))
1403: expect(note(el, "s2")!.textContent).toContain(fill("suggestions.fix_internal", { wrong: "ZURRITO", right: "ZURITO" }))
1406: expect(field(el, "empty")).toBeNull()
1407: expect(field(el, "typo")).toBeNull()
1408: expect(api.getContentTranslationCells).not.toHaveBeenCalled()
1409: expect(save(el).disabled).toBe(true)
1411: expect(note(el, "s1")).toBeNull()
1412: expect(api.discardContentSuggestion).toHaveBeenCalledWith("s1")
```

##### reads a named item with a staff-name fix by reference once per opening on the default-language page

Old `content-translations-dialog.drafts.test.ts:1331` → current `:1414`: keeps named-item note metadata through live changes and reopening without reference reads. Authority: Task10/11 and the relevant replacement category above.

Old checks:

```text
1349: expect(namedReads()).toBe(1)
1356: expect(field(el, id)!.value).toBe(`CLIENT-ca ${id}`)
1358: expect(namedReads()).toBe(1)
1362: expect(field(el, "two")?.value).toBe("CLIENT-ca two")
1363: expect(namedReads()).toBe(2)
```

Current checks:

```text
1428: expect(note(el, "s1")!.querySelector("a")!.getAttribute("href")).toBe("/manage/catalogue/product/named")
1436: expect(field(el, id)!.value).toBe(`CLIENT-ca ${id}`)
1438: expect(api.getContentTranslationCells.mock.calls
    .flatMap(([refs]) => refs)
    .some((ref) => ref.id === "named")).toBe(false)
1444: expect(field(el, "two")!.value).toBe("CLIENT-ca two")
1445: expect(note(el, "s1")!.querySelector("a")!.getAttribute("href")).toBe("/manage/catalogue/product/named")
1448: expect(api.getContentTranslationCells.mock.calls
    .flatMap(([refs]) => refs)
    .some((ref) => ref.id === "named")).toBe(false)
```

##### a suggestion read begun before a Discard does not bring back the left-out item it was for

Old `content-translations-dialog.drafts.test.ts:1365` → current `:1454`: a read begun before Discard cannot restore an off-page draft. Authority: Task10/11 and the relevant replacement category above.

Old checks:

```text
1368: expect(field(el, "empty")!.value).toBe("CLIENT-ca Croquetes")
1380: expect(api.getContentSuggestions.mock.calls.length).toBeGreaterThan(reads)
1383: expect(field(el, "empty")!.value).toBe("")
1385: expect(field(el, "empty")).toBeNull()
1386: expect(field(el, "one")).not.toBeNull()
```

Current checks:

```text
1468: expect(api.getContentSuggestions.mock.calls.length).toBeGreaterThan(reads)
1474: expect(note(el, "s1")).toBeNull()
1475: expect(save(el).disabled).toBe(true)
1476: expect(field(el, "one")).not.toBeNull()
1477: expect(q(el, "[data-test=edited-count]")!.textContent).toContain("0")
```

##### reads no left-out item by reference on the default-language page for a fix to a name in some language

Old `content-translations-dialog.drafts.test.ts:1388` → current `:1479`: a language-fix note needs no automatic reference read on the default-language page. Authority: Task10/11 and the relevant replacement category above.

Old checks:

```text
1403: expect(field(el, "one")).not.toBeNull()
1404: expect(api.getContentTranslationTargets.mock.calls.filter(([, query]) => query.targets)).toEqual([])
```

Current checks:

```text
1494: expect(field(el, "one")).not.toBeNull()
1495: expect(note(el, "s1")!.textContent).toContain("Pann")
1496: expect(api.getContentTranslationCells).not.toHaveBeenCalled()
1497: expect(api.getContentTranslationTargets).toHaveBeenCalledTimes(1)
```

##### reads no item by reference on another language's page for suggestions that cannot fill it

Old `content-translations-dialog.drafts.test.ts:1408` → current `:1499`: notes need no reads and an off-page default-language suggestion stages only its empty field. Authority: Task10/11 and the relevant replacement category above.

Old checks:

```text
1425: expect(field(el, "one")!.value).toBe("CLIENT-es one")
1426: expect(api.getContentTranslationTargets.mock.calls.filter(([, query]) => query.targets)).toEqual([])
```

Current checks:

```text
1520: expect(field(el, "one")!.value).toBe("CLIENT-es one")
1521: expect(api.getContentTranslationCells).toHaveBeenCalledExactlyOnceWith([
    { kind: "product", id: "done", language: "en", field: "name" },
])
1525: expect(field(el, "done", "en")!.value).toBe("CLIENT-en done")
1526: expect(field(el, "done", "es")!.value).toBe("Hecho")
```

##### stops reading omitted items once the dialog closes during a read

Old `content-translations-dialog.drafts.test.ts:1430` → current `:1528`: stops applying off-page cell reads after close without starting another batch. Authority: Task10/11 and the relevant replacement category above.

Old checks:

```text
1454: expect(targetReads()).toBe(2)
1457: expect(targetReads()).toBe(3)
1465: expect(targetReads()).toBe(3)
```

Current checks:

```text
1543: expect(api.getContentTranslationCells).toHaveBeenCalledTimes(1)
1548: expect(api.getContentTranslationCells.mock.calls.length).toBeGreaterThan(reads)
1559: expect(api.getContentTranslationCells).toHaveBeenCalledTimes(count)
1560: expect(el.open).toBe(false)
```

##### fills at most 100 drafts, says so, and saves those 100

Old `content-translations-dialog.drafts.test.ts:1477` → current `:1572`: fills at most one hundred cells and saves that exact batch after explicit paging. Authority: Task10/11 and the relevant replacement category above.

Old checks:

```text
1479: expect(q(el, "[data-test=suggestion-capacity]")!.textContent!.trim()).toBe(fill("suggestions.capacity", { shown: "100" }))
1484: expect(field(el, "100")!.value).toBe("")
1485: expect(field(el, "100")!.disabled).toBe(true)
1487: expect(el.open).toBe(false)
1489: expect(edits).toHaveLength(100)
1490: expect(edits.at(-1)).toEqual({
    kind: "product",
    id: "099",
    expected: "baseline-099",
    text: "CLIENT-es 099",
})
```

Current checks:

```text
1574: expect(api.getContentSuggestions).toHaveBeenCalledTimes(1)
1576: expect(q(el, "[data-test=suggestion-capacity]")).not.toBeNull()
1577: expect(q(el, "[data-test=suggestion-capacity]")!.textContent!.trim()).toBe(fill("suggestions.capacity", { shown: "100" }))
1582: expect(field(el, "100")!.value).toBe("")
1583: expect(field(el, "100")!.disabled).toBe(false)
1585: expect(el.open).toBe(false)
1587: expect(edits).toHaveLength(100)
1588: expect(edits.at(-1)).toEqual(submitted("099", "CLIENT-es 099"))
1589: expect(edits.map((edit) => edit.id)).toEqual(Array.from({ length: 100 }, (_, n) => String(n).padStart(3, "0")))
```

##### says the general limit, not the suggestion count, once every filled suggestion is edited

Old `content-translations-dialog.drafts.test.ts:1497` → current `:1593`: shows the general cell limit when all borrowed cells become personal. Authority: Task10/11 and the relevant replacement category above.

Old checks:

```text
1506: expect(q(el, "[data-test=suggestion-capacity]")).toBeNull()
1507: expect([...el.shadowRoot!.querySelectorAll("[role=status]")].some((node) => node.textContent!.trim() === t("translations.capacity"))).toBe(true)
```

Current checks:

```text
1600: expect(q(el, "[data-test=suggestion-capacity]")).toBeNull()
1601: expect([...el.shadowRoot!.querySelectorAll("[role=status]")].some((node) => node.textContent!.trim() === t("translations.batch_full"))).toBe(true)
```

##### closing keeps every suggestion for the next opening

Old `content-translations-dialog.drafts.test.ts:1513` → current `:1607`: closing keeps every suggestion for the next opening. Authority: Task10/11 and the relevant replacement category above.

Old checks:

```text
1521: expect(el.open).toBe(false)
1524: expect(field(el, "two")?.value).toBe("CLIENT-es two")
1525: expect(field(el, "one")!.value).toBe("CLIENT-es one")
1526: expect(api.discardContentSuggestion).not.toHaveBeenCalled()
```

Current checks:

```text
1615: expect(el.open).toBe(false)
1619: expect(field(el, "one")!.value).toBe("CLIENT-es one")
1620: expect(field(el, "two")!.value).toBe("CLIENT-es two")
1621: expect(api.discardContentSuggestion).not.toHaveBeenCalled()
```

##### saving a page closes the dialog, and the next opening fills the rest

Old `content-translations-dialog.drafts.test.ts:1528` → current `:1623`: saving a batch closes and reopening fills the remaining saved-on-box suggestions. Authority: Task10/11 and the relevant replacement category above.

Old checks:

```text
1531: expect(el.open).toBe(false)
1534: expect(field(el, "100")?.value).toBe("CLIENT-es 100")
1536: expect(field(el, "000")).toBeNull()
1537: expect(q(el, "[data-test=suggestion-capacity]")).toBeNull()
1538: expect(field(el, "149")!.value).toBe("CLIENT-es 149")
```

Current checks:

```text
1626: expect(el.open).toBe(false)
1630: expect(field(el, "000")).toBeNull()
1631: expect(field(el, "100")!.value).toBe("CLIENT-es 100")
1632: expect(field(el, "149")!.value).toBe("CLIENT-es 149")
1633: expect(q(el, "[data-test=suggestion-capacity]")).toBeNull()
```

##### rejects a suggestion continuation from another language configuration before borrowing text

Old `content-translations-dialog.drafts.test.ts:1542` → current `:1637`: rejects a continuation from another configuration while retaining previously borrowed cells. Authority: Task10/11 and the relevant replacement category above.

Old checks:

```text
1556: expect(api.getContentSuggestions).toHaveBeenCalledWith({
    after: "1",
    configuration: "original-config",
})
1560: expect(field(el, "one")!.value).toBe("")
1564: expect(bar.error).not.toBe("")
```

Current checks:

```text
1651: expect(bar(el).error).not.toBe("")
1652: expect(api.getContentSuggestions).toHaveBeenLastCalledWith({
    after: "1",
    configuration: "configuration-one",
})
1656: expect(field(el, "one")!.value).toBe("CLIENT-es one")
1657: expect(field(el, "two")!.value).toBe("")
```

## Checkpoint extra-pairs

### A682 extra-source preparation: changed test checks

Base: `2d7efd2dd0ab85315269736f4e0014ffd95cf622`. No PR or partial publication.

#### Deliberate changes

- `packages/catalogue/src/offered-modifiers.test.ts:268`: the complete extras-list expectation gains the required six-field `presentation` for bacon, cheese and olives. Every earlier key and value remains. Approved Task 12 requires separate parent/relative-variant source facts.
- `apps/till/src/state/draft-lines.test.ts:193` and `:201`: the `burgerLine` expected fixture changes `listCustomerName: null` to `{en: "doneness staff"}` and `{en: "onions staff"}`. These are newly reconstructed option answers; `fromDraftLine` calls `snapshotOf`, then the already implemented `optionSnapshotOf`. Task 12 requires default/staff preparation for these new answers. The original five round-trip/return/no-merge/version checks remain exact equality checks; no retained snapshot reader changed. The two original fixture snippets match G's current file; only F's copy changed.
- `apps/server/src/till-api.sell-published.test.ts:1084` and `:1108`: the ordinary section-write input and expected structure use canonical `es`, replacing `[LOCALE]` (`es-ES`), with the same `Para terminar` text. Tasks 1/4 require canonical translation-map keys. The fiscal/receipt `LOCALE` constant, other map keys and every other value remain.
- `packages/catalogue/src/content-translation-gaps.test.ts:237`: arbitrary nonblank Spanish-field fixture text `CLIENT Nombre` becomes `CLIENT Spanish unit` after the root English-vocabulary guard rejected `nombre`. Language keys, blank/nonblank cases, staff identity and every assertion remain unchanged. No guard was edited. `git blame` attributes the fixture to this branch's `73bfe9f40`.

#### Additive fixtures

The following original offer fixtures gain a standalone presentation object with their existing staff/customer/kitchen fields and null relative-variant fields. No previous data is removed. The literal audit checks the original objects against G after removing only F's earlier unit staff fields; current intersections also match B/G originals. The navigation fixture matches literally. The new module field is outside B/E/G's changed contracts.

- `apps/till/src/api/client.test.ts:4379` (before this continuation).
- `apps/till/src/api/client.test.ts:4826` (before this continuation).
- `apps/till/src/screens/till-table-order-screen.a11y.test.ts:272` (before this continuation).
- `apps/till/src/screens/till-table-order-screen.test-helpers.ts:62` (before this continuation).
- `apps/till/src/screens/till-table-order-screen.test.ts:2236` (before this continuation).
- `apps/till/src/state/as-served-diet.test.ts:7` (before this continuation).
- `apps/till/src/state/draft-lines.test.ts:92` (before this continuation).
- `apps/till/src/state/held-extras.test.ts:7` (before this continuation).
- `apps/till/src/state/menu-refresh.test.ts:48` (before this continuation).
- `apps/till/src/till-app-menu-refresh.test.ts:89` (before this continuation).
- `apps/till/src/till-app.test.ts:6209` (before this continuation).
- `apps/till/src/widgets/basket.a11y.test.ts:169` (before this continuation).
- `apps/till/src/widgets/basket.test.ts:28` (before this continuation).
- `apps/till/src/widgets/menu-browser.test.ts:2046` (before this continuation).
- `apps/till/src/widgets/modifier-picker.a11y.test.ts:10` (before this continuation).
- `apps/till/src/widgets/modifier-picker.save-state.test.ts:13` (before this continuation).
- `apps/till/src/widgets/modifier-picker.test.ts:32` (before this continuation).
- `apps/till/src/widgets/modifier-picker.unsaved.test.ts:62` (before this continuation).
- `apps/till/src/widgets/modifier-picker.unsaved.test.ts:84` (before this continuation).
- `apps/till/src/widgets/tender-pay.test.ts:1630` (before this continuation).
- `packages/catalogue/src/menu-change-navigation.test.ts:457` (before this continuation).

`assertion-audit.json` records 6186 existing matcher-call expressions, 6185 exact syntax matches and one expanded whole-shape expression. That is a syntax inventory, not proof of behavioral equivalence; changes to indirect fixtures above are recorded separately. The new extra-source suite adds five runtime cases using real venue databases. No existing money, VAT, quantity, login, permission, drawer, fiscal or root-guard expected value changed.

#### Verification and qualifications

- Source till: final complete 17 files, 2,311 PASS. The first run had five draft-option expected-fixture failures, retained in `till-final.log`; the final corrected run is `till-corrected-final.log`.
- Independently frozen-installed candidate: catalogue 7 complete files / 276 PASS; server 3 / 130 PASS; till 5 / 355 PASS. Final candidate matched all 6,715 tracked/new source paths before cleanup. Subsequent changes are only the dated profile-rejection notes in `docs/backlog.md` and `docs/backlog/till.md`.
- Unedited protected fiscal suites: 20 PASS and both files byte-identical to `347c5fa4`. Root browser-purity/module/English guards: 4,820 PASS. Six affected package typechecks, 27 changed TypeScript-file lint/format and whitespace checks passed. No whole-package coverage, full-server, whole-feature, visual or physical acceptance claim.
- Four independent installed faults caught 5/1/3/4 assertion failures: remove pair, remove name-source comparison, copy resolved defaults into raw sources, borrow parent customer map for variant. Each restoration passed all five new cases. Logs retain the failing assertions.
- Initial new test used a nonexistent `extra_product_changed` kind; actual changes use `product_changed`. The corrected test still catches removal of the comparison. First RED also lacked the raw field, as intended; do not count the incorrect kind as independent evidence.
- Initial source/installed till runs failed the five obsolete draft fixture values. Initial installed server run failed the noncanonical section input. It also named an absent `content-translations-api.receipts.test.ts` filter; that path ran no suite. Final server explicitly ran actual `content-translations-api.test.ts`, `receipt-presentation.test.ts` and `till-api.sell-published.test.ts`.
- Root's first run failed the branch's arbitrary `nombre` fixture value. After changing only that string, its 13 cases and all 4,820 root cases passed. Initial typechecks reported missing required presentation fixtures; six final package types pass after additive fixture updates.
- First fixture audit rejected absent unit staff fields in G; qualified comparisons remove only F's previous fields. Final contract-audit attempts also needed to recognize `readonly` and semicolon declarations. Failed helpers are not passing evidence; final `foreign-fixture-qualification.json` has 18 current intersecting fixture/contract matches.
- The final full till run logs Lit warnings and a null-identity rejection. A focused existing profile-switch case reproduces that same rejection, passes one case and skips 1,012; it deliberately returns null and asserts one captured rejection. This does not establish the cause of every historical log or real-device behavior. The existing backlog investigation now has the dated bounded receipt; no profile code/test changed.
- Own candidate, parent and detached registration removed after an observed positive CWD probe, its recorded child was terminated/reaped, and no candidate holder remained. All owned tool sessions collected. No dev stack, reviewer or landing lock was started. No foreign queue/worktree/branch/process was changed.

Task 12 consumer integration still waits for G's reserved source/money functions, and Tasks 4–7 boot integration waits for E. Tasks 13/14 remain. Preserve every earlier A682 inventory for the eventual sole PR's Changed test checks. The eventual PR first line must declare existing venue-folder reset/reseed; no reset or A760 execution is authorized here.

## Checkpoint future

### A682 continuation: future snapshot preparation (unpublished)

Base for this continuation: `500c01777ef004935ee13cb0f83a712246ddd18f`.
Authority: approved `docs/superpowers/plans/2026-10-17-a682-translations.md`, Task 12, and the design's final dated closure.
Keep this inventory AND every earlier A682 inventory for the single eventual PR's **Changed test checks** section.
No final review, push, PR, finish or land was attempted.

#### Changed existing checks

| Current file:line                                   | Before                                                 | After                                                                                                                       | Authority                                                        |
| --------------------------------------------------- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `apps/server/src/modifier-selection.test.ts:235`    | weighted extra abbreviation map contains en+es         | exactly en, the given default; physical amount, portion, unit context, precision, price and VAT unchanged                   | Task 12: single-default abbreviation preparation                 |
| same file:330–331                                   | absent list/label customer map stays null              | each map freezes its own staff name under es                                                                                | Task 12: independently resolve list/label before freezing        |
| same file:341                                       | Each unit receipt/context maps retain all translations | receipt `{en: "ea"}`, full context name `{en: "Each"}`; all other expected facts unchanged                                  | Task 12: distinct receipt abbreviation and new full-name context |
| `apps/server/src/working-order.test.ts:1536`        | receipt unit name kg                                   | su, the fixture's explicitly stored staff abbreviation; all integer quantities, price basis, totals and precision unchanged | Task 12: missing-default unit falls back to staff abbreviation   |
| same file:6373 and :6398                            | kitchen text contains 0.150/0.450 kg                   | same amounts and Jamón name, with su from the frozen unit; other rows/totals unchanged                                      | same default unit rule                                           |
| same file:9334–9335                                 | scenario's expected frozen/printed value Petit verre   | 125 ml, that variant's own staff name; the French source stays supplied; receipt keys and rename/reprint checks unchanged   | Task 12: never select an unrelated third language for new names  |
| same file:9416                                      | both invoice-language keys contain Grand verre         | both contain own variant staff name 175 ml; all keys retained                                                               | same independent fallback rule                                   |
| `packages/catalogue/src/menu-document.test.ts:1356` | unit-name-only edit produces no extras unit change     | must produce that change; fixture edit retained                                                                             | Task 12: new context names participate in publication comparison |

Three fixture inputs changed canonical content keys only, retaining every text value: `working-order.test.ts:488`, `:628` (Large cup) and `:8764` (Copa grande), es-ES → CONTENT_LANGUAGE/es. The invoice locale remains es-ES. These are distinct hunks from G's import-only changes in that file (orientation and foreign-final receipts). No G file was modified.

`assertion-audit.json` records old/current expressions and lines. Of 1,166 old matcher expressions, 1,157 remain identical and nine have the authorized replacements above. Current files contain 1,200 matchers, including 43 new/replacement expressions. Scenario expected values and the three canonical input changes are separately listed because the matcher syntax audit cannot detect them. This is syntax evidence, not a claim that fixture changes are equivalent. No old case was deleted; changed behavior titles describe the replacement contract. Existing money, VAT, login, permissions, cash-drawer, fiscal and root-guard expectations were not changed.

#### Observed failures and passing receipts

- `product-red.log`: three assertion failures, then product-green 18 passed.
- `unit-qualified-red.log`: five intended assertion failures, then unit-product-green 35 passed. Initial absent-export TypeErrors and the new test's initially incorrect VAT scale 0.21 are NOT qualified RED evidence; the scale was corrected to 21.00 before the qualified run.
- `composition-red.log`: two assertion failures in the composed-label consumer, then helpers-green 49 passed.
- `publication-red.log`: three missing change entries; publication-green four passed (100 deliberate name-filter skips).
- `options-server-red.log`: two intended assertions; options-till-red three; retained-options-red two. All final named suites pass.
- `baseline-working-order.log`: the independently installed prior checkpoint reproduces 26 canonical-key setup failures (207 pass). Correcting the three canonical inputs on the feature branch exposes the new staff/third-language behavior checks; `working-order-final.log` passes all 233. Earlier intermediate failure logs remain and are excluded from final green claims.
- Source focused checks: catalogue 490; final working-order 233, modifier-selection 39 and receipt 98; till 122; shared historical content-language suite 55; root browser-purity 177. Catalogue/server/till typechecks, 14 changed TypeScript files' ESLint, source formatting and whitespace exit zero. The root command also named a nonexistent till-browser-purity path; only the actual one-file/177-test dashboard-browser-purity result is claimed.
- Installed complete final candidate: catalogue 12 files/490 tests, server three files/370, till two files/122, protected fiscal two files/20; no failures/skips. `candidate-comparison-final.json` records 6,714 source paths with no difference before cleanup. Later backlog-only wording is recorded separately; no tested code changed.
- Eight installed independent omission controls (`controls.json`) fail at assertions (11/2/3/5/3/2/2/3 cases respectively), and each exact restoration passes. They cover unrelated-language fallback, enabled output keys, variant staff identity, unit preparation, publication comparison, retained option maps, list/label staff separation and till preparation.
- `protected-integrity.json`: both protected fiscal tests byte-identical to 347c5fa. Their unchanged 20 cases pass beside snapshot work. No writer, golden value, chain, numbering or fiscal fixture changed.
- No package coverage, whole-feature readiness, visual, physical, full-server or live-Cloud claim. The remaining parent/frozen-source consumer paths are not complete.

#### Rulings and remaining work

New answer preparation and recorded-answer comparison use separate projections of the SAME OptionSnapshot shape. The comparison-only projection retains the existing shared historical resolver, including null maps; it is never written. The two hand-written retained-answer cases catch omission of that comparison, while original changed-answer cases still pass. Historical snapshot readers and shared resolveSnapshotText remain unchanged.

The mandatory-staff defaultLanguageDescriptions/defaultLanguageText signature change stays pending until G's reserved working-order consumers can be updated together. Independent modifier/held-option producers call newCustomerText directly meanwhile; later consolidation must retain these assertions. newCustomerPresentation is implemented/tested, but its frozen raw parent/variant pair and actual extras consumer remain pending. Inspect free catalogue/type/fixture hunks for independent source-pair work next; never edit G's priceOrderLines/recalled/retained or till source functions before release/landing. E bootServer/configured-origin cleanup remains reserved. New-extra edit preparation, full unit-context projection and parent/till toPriceable integration remain due.

Task 13 must audit the whole base-to-tip prose, especially products.md's old default/companion claims, modifiers.md's new-answer third-language wording, and the option-snapshot-labels.ts comment that says till maps remain whole. Do not change historical reader behavior. Whole-feature visual/integration acceptance and Task 14's sole final Claude review, normal push hook, current-head CI, H11-locked land, main install/own cleanup/H12 remain due.

Qualifications: the first install wrapper's session id was not retained; frozen install was rerun before the baseline, and the original wrapper is not used as exit-status proof. New placeholder assertions and every intermediate failing run are retained. docs/backlog.md is ignored by Prettier (`--file-info`); its own-entry diff and whitespace were checked, with no docs-format claim. Existing Lit dev/occupied-port warnings are in browser logs. Cleanup removed only this continuation's detached candidate/parent, after a positive cwd probe and no candidate holders; recorded child pids were absent. No runtime/dev stack/reviewer/landing lock was started or left running.

## Checkpoint legacy

### A682 changed test checks: legacy editor retirement

Authority: approved design `docs/superpowers/specs/2026-10-17-a682-translations-design.md`, “Proposed behavior”, “One Save, one transaction”, “Translate all and Use fix”, and the dated unit-A/Spanish-A closure; implementation-plan Tasks 7, 9–11. This is an unpublished implementation checkpoint, not whole-feature completion.

All 38 original model case groups survive in order as 40 runtime cases. A new overflow-discard regression makes 41. The real multilingual model is now under test; the old model is deleted. Representation changes include four-part cell identities, explicit null clears, per-language baselines, field unstaging and per-id suggestions. The existing second multilingual model suite remains unchanged.

The approved behavior deliberately changes these old expectations:

- Default companions are optional independent language cells. Explicitly editing a filled/default language is allowed; no second language is submitted merely because another was edited. Clearing a saved name remains an edit; returning an already-blank field to blank is clean but suppresses autofill.
- The 101st personal input is retained and blocks Save; untouched suggested cells give way first. Free capacity does not silently select previously waiting suggestions.
- Touching a suggestion gives the person ownership, even after typing back to its suggested text. Discard does not erase that personal work.
- Per-id Discard replaces row-group suppression. Deleting one id cannot suppress a fresh independent id or another language; stored suppression applies only to deleted ids. An omitted bounded page is not evidence that a retained target was deleted. Explicit current-cell unavailable evidence still withdraws borrowed fills and preserves personal edits for review.
- Default changes never retarget an old English draft to French. Keep/Replace/Discard is chosen per language cell; another person's English fill does not silently remove an English personal draft.
- Page display order belongs to `TranslationPages`, not the cell draft store. The new `content-translations-pages.test.ts` last case keeps the original literal `arrival, 001` ordering assertion with an unchanged personal value/baseline and no review faults.

#### Model case map

Old line numbers refer to `9472bae42667bd3f95127a02c742ca51bf98e65e`; current line numbers refer to this checkpoint. `model-test-before.ts` and `source-final.patch` preserve full old/new bodies. `assertion-audit.json` is a structural matcher inventory, not proof that equivalent fixture values were used.

| Before: old line and case                                                                                                                       | After: current line and case                                                                                                                                                       |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `27` requires an explicit blank companion, never copying staff text                                                                             | `apps/dashboard/src/widgets/content-translations-model.test.ts:67` allows a blank default and never copies staff text into either language                                         |
| `51` keeps edits for hidden targets and distinguishes identical ids in different kinds                                                          | `apps/dashboard/src/widgets/content-translations-model.test.ts:83` keeps edits for hidden targets and distinguishes identical ids in different kinds                               |
| `65` omits untouched rows and cancels an edit when both fields are empty or whitespace                                                          | `apps/dashboard/src/widgets/content-translations-model.test.ts:95` omits untouched cells and cancels edits returned to their blank baselines                                       |
| `79` preserves existing effective defaults and never sends an unsolicited second language                                                       | `apps/dashboard/src/widgets/content-translations-model.test.ts:109` preserves an unedited effective default and sends a second language only when explicitly edited                |
| `92` bounds drafts at 100 and admits a new target after undoing one                                                                             | `apps/dashboard/src/widgets/content-translations-model.test.ts:126` retains the 101st personal cell and admits it after undoing one selected cell                                  |
| `105` checks actual UTF-8 bytes for both fields and the serialized batch                                                                        | `apps/dashboard/src/widgets/content-translations-model.test.ts:139` checks actual UTF-8 bytes for both language fields and the serialized batch                                    |
| `124` does not stage unavailable targets or redirect unknown references                                                                         | `apps/dashboard/src/widgets/content-translations-model.test.ts:157` does not stage unavailable targets or redirect unknown references                                              |
| `131` compares trimmed input with its selected baseline rather than raw typing                                                                  | `apps/dashboard/src/widgets/content-translations-model.test.ts:164` compares trimmed input with its saved baseline and unstage restores saved text                                 |
| `145` holds arrivals and dirty departures without adopting a concurrent fill                                                                    | `apps/dashboard/src/widgets/content-translations-model.test.ts:178` retains dirty departures without adopting a concurrent fill and accepts a separate page                        |
| `163` accepts the current baseline only after explicit %s                                                                                       | `apps/dashboard/src/widgets/content-translations-model.test.ts:198` accepts the current baseline only after explicit %s                                                            |
| `184` retains unavailable edits and refuses to reassign them to replacement owners                                                              | `apps/dashboard/src/widgets/content-translations-model.test.ts:221` retains unavailable edits and refuses to reassign them to replacement owners                                   |
| `218` incorporates latest arrivals in order on review while preserving unchanged drafts                                                         | `apps/dashboard/src/widgets/content-translations-model.test.ts:250` incorporates the latest page in order while preserving unchanged drafts                                        |
| `233` reviewing a changed default never transfers the old companion into the new language                                                       | `apps/dashboard/src/widgets/content-translations-model.test.ts:262` reviewing a changed default never transfers an English draft into French                                       |
| `262` a clean departure can return as a new arrival rather than disappearing forever                                                            | `apps/dashboard/src/widgets/content-translations-model.test.ts:297` a clean departure can return on a later page rather than disappearing forever                                  |
| `271` a draft added during a scan stays marked for review when that scan omitted its reference                                                  | `apps/dashboard/src/widgets/content-translations-model.test.ts:306` a draft added while another page loads is retained without falsely treating omission as deletion               |
| `281` keeping a draft whose companion was filled elsewhere never stages that obsolete companion                                                 | `apps/dashboard/src/widgets/content-translations-model.test.ts:320` reviews each language separately when another person fills the former companion                                |
| `313` fills untouched eligible rows that have no text, and leaves a person's edit alone                                                         | `apps/dashboard/src/widgets/content-translations-model.test.ts:345` fills untouched eligible empty cells and leaves a person's edit alone                                          |
| `351` skips a stale suggestion, a placeholder, and a missing default with no suggestion of its own                                              | `apps/dashboard/src/widgets/content-translations-model.test.ts:364` skips stale suggestions and placeholders but does not require a default-language suggestion                    |
| `380` stops at 100 drafts counting a person's edits, and a freed place goes to the next row                                                     | `apps/dashboard/src/widgets/content-translations-model.test.ts:391` counts personal cells toward 100, evicts borrowed fills first and leaves overflow for explicit selection       |
| `409` an edited suggestion is the person's edit until it matches the suggestion again, and reset restores it                                    | `apps/dashboard/src/widgets/content-translations-model.test.ts:414` touching a suggestion takes personal ownership even when typing back to its text                               |
| `428` typing back to the suggestion after a refresh makes it a suggestion again                                                                 | `apps/dashboard/src/widgets/content-translations-model.test.ts:432` typing back to a suggestion after a refresh retains personal ownership                                         |
| `438` a person's companion beside a suggested name keeps the suggested name                                                                     | `apps/dashboard/src/widgets/content-translations-model.test.ts:442` a personal English field beside a suggested Spanish name keeps both independent cells                          |
| `457` unsuggest empties the row and ignores that suggestion when read again, but not a new one                                                  | `apps/dashboard/src/widgets/content-translations-model.test.ts:453` Discard empties the borrowed cell and ignores that id on later reads, but accepts a new id                     |
| `470` unsuggest takes back from a person's edit each field they left as the suggestion filled it                                                | `apps/dashboard/src/widgets/content-translations-model.test.ts:465` Discard removes only borrowed language cells and preserves each personal field                                 |
| `504` unsuggest takes back what a deleted suggestion filled after a read stopped listing it, and nothing for another suggestion's deletion      | `apps/dashboard/src/widgets/content-translations-model.test.ts:487` Discard takes back its borrowed field after a page stopped listing the id, and unrelated deletion does nothing |
| `525` unsuggest leaves an edit's borrowed text alone when the discarded suggestion is a later one it never borrowed from                        | `apps/dashboard/src/widgets/content-translations-model.test.ts:500` Discard of a later unborrowed suggestion leaves the earlier borrowed cell alone                                |
| `559` unsuggest ignores the row's suggestion once one of the discarded group is deleted, even after a read regrouped the row, but not a new one | `apps/dashboard/src/widgets/content-translations-model.test.ts:513` discarding one old id does not suppress a replacement borrowed from a different id                             |
| `575` unsuggest lets a new id a read grouped with the discarded ones fill the row once it comes alone                                           | `apps/dashboard/src/widgets/content-translations-model.test.ts:524` accepts an independently returned new id after the old id was discarded                                        |
| `585` unsuggest keeps a later read's suggestion out of the row while it groups a discarded id with new ones                                     | `apps/dashboard/src/widgets/content-translations-model.test.ts:533` a discarded id cannot refill its cell while a new id fills a separate language                                 |
| `596` unsuggest keeps every suggestion of the discarded group out of the row when no read had listed them yet                                   | `apps/dashboard/src/widgets/content-translations-model.test.ts:546` Discard suppresses its exact id even before a read has listed it                                               |
| `604` unsuggest leaves a row unedited when only the suggestion's text was left in it                                                            | `apps/dashboard/src/widgets/content-translations-model.test.ts:556` Discard leaves no dirty edit when personal input returned to saved text                                        |
| `617` an edited row compares with the newest suggestion, not the one it was filled from                                                         | `apps/dashboard/src/widgets/content-translations-model.test.ts:568` new suggestion text cannot silently replace an edited cell even when it matches old or new suggestions         |
| `640` unsuggest and markStale on a row with no suggestion leave the other rows filled                                                           | `apps/dashboard/src/widgets/content-translations-model.test.ts:589` Discard and stale evidence for a bare cell leave other suggestions filled                                      |
| `650` markStale keeps the suggestion as out of date and fills nothing from it                                                                   | `apps/dashboard/src/widgets/content-translations-model.test.ts:599` stale evidence withdraws just its untouched suggestion and fills nothing from it                               |
| `666` a suggested row in the scan is refreshed; one the scan stops listing goes, fill and all                                                   | `apps/dashboard/src/widgets/content-translations-model.test.ts:611` refreshes returned suggestions and retains an off-page fill until explicit current-cell evidence withdraws it  |
| `692` a new default language is taken up while only suggestions are filled                                                                      | `apps/dashboard/src/widgets/content-translations-model.test.ts:636` a new default refreshes untouched suggestions without creating personal edits or changing languages            |
| `701` checks a suggested name's UTF-8 bytes like a typed one                                                                                    | `apps/dashboard/src/widgets/content-translations-model.test.ts:652` checks a suggested name's UTF-8 bytes like a typed one                                                         |
| `711` indexes each item's suggestions for the page language, its default and its notes                                                          | `apps/dashboard/src/widgets/content-translations-model.test.ts:658` keeps language suggestions, staff notes and placeholders independent instead of grouping their stale flags     |

#### Other changed checks and fixtures

- `apps/dashboard/src/api/client.test.ts:3122`: the three original transport cases retain encoded cursor/ref reads, exact echoed response, serialized whole request, PUT, active background write and exact refusal params. Their old `/:language` paths and `defaultText` companion payloads become repeated projected languages and exact language/name cells on the language-free path (plan Task 7). The old completeness-refusal fixture becomes `product.invalid/customerName` because completeness no longer refuses Save. The 3-case block is retained as `client-tests-before.ts`.
- `apps/dashboard/src/api/live-queries.test.ts:93` and the “refreshes translation targets passively” case: query arguments/response fixture use the current multilingual query/configuration DTO. Every old matcher remains; dependency and passive-activity checks are unchanged.
- `apps/dashboard/src/screens/content-languages-screen.a11y.test.ts:57`: replace the old string-language fixture with the real projected-item/cell response, including unit abbreviation cells and field-specific staff text. All 19 old matchers remain. The eight language/theme/viewport action cases additionally require an actual Catalan field, an empty native input and no read-error before axe/screenshot checks. Both theme matrices still execute all 32 runtime cases.
- `apps/server/src/till-api.receipt.test.ts:1230`: migrate the request fixture to the language-free GET/PUT, read its cell token, and supply the same-origin header plus explicit Spanish/name identity. Every one of the file's 419 matcher expressions is unchanged, including exact retained rows, fiscal-row/series/publication equality and original reprint wording. No price/VAT/permission/drawer/fiscal assertion, writer, golden or protected test changed.
- `packages/catalogue/src/content-translations.test.ts`: only the internal resolution type's import moves. All 60 matcher expressions remain.
- `TranslationTarget` continues as the suggestion collector's internal resolution shape. It moves from the browser transport leaf to the server-side target module with every field unchanged. It is not a compatibility HTTP response; no retired URL is reintroduced.

#### Verification and qualification

- Original two model suites: 97 PASS. Migrated suites before new bug case: 97 PASS. The overflow-discard case then failed with waiting count 1 instead of 0, before the one-line deletion from `#waiting` was added.
- Screen fixture negative run: two selected cases failed on missing actual Catalan input. Current full screen suite: 32 PASS. All eight EN/ES × light/dark × 390/1280 rendered screen/editor views inspected. Vitest scales the raster; these are mounted components, not physical/full-server trials.
- Receipt negative run: 404 on the retired URL; after route migration, 403 exposed the missing same-origin fixture header. After supplying it, the complete receipt suite is 98 PASS. No assertion was loosened for either refusal.
- Full surrounding source browser selection: 21 suites, 1043 PASS, 0 FAIL, 0 SKIP. Later stricter native-screen assertions: 32 PASS; later page-order addition plus both models: 149 PASS. Installed isolated candidate: 6 complete browser files, 491 PASS, followed by the current page/model files. Catalogue 5 complete files: 156 PASS. Protected fiscal 2 files: 20 PASS, byte comparison against branch base retained. Dashboard/catalogue/server typechecks and changed-TypeScript lint/format/whitespace pass.
- Four deliberate installed faults fail assertion cases as intended, restored models pass after each: waiting removal (1), replacement-owner Keep (3), per-id Discard (6), no-op personal-blank priority (1). Exact commands and failed assertions are in `controls.py`, `controls.json` and their individual logs.
- Root selection initially had 3 ENOENT failures because a deleted tracked file was still present in the index. Stage the authorised deletion; all 2987 tests pass with the five root guard files byte-unchanged. No guard edit is part of this checkpoint.
- Qualification excludes the first audit helper's undefined-AST-argument error, the first stale-path foreign audit after G removed its own candidate, and the first page-order audit's unnormalised `/var` vs `/private/var` own-candidate comparison. That last audit exited before editing; the test command following it ran the unchanged 148 cases. The corrected current test run is `pages-with-order-final.log` (149 cases). None is used as a passing new-check receipt.
- Existing Lit dev-mode and occupied-port warnings are retained in raw logs. No package-wide coverage, whole-feature readiness, external review, PR, push, finish/land or reset claim.

#### Remaining whole-item duties

Task 12 future presentation/snapshots and G source/money integration remain; E boot callback/configured-origin integration remains reserved. Complete whole-range prose and full acceptance (Task 13), then the sole final Claude run-it review, normal push hook, exact-head CI, authorised H11-locked landing, main install/owned cleanup and exact-merge CI (Task 14). Retain all earlier receipts. Do not redo the migrated original standard/a11y/drafts/model suites or reintroduce legacy transport.

## Checkpoint original-suites

### A682 original standard-suite migration — retain for the single eventual PR

Continuation from signed-off `274d508f67b6520d48441e4109545ca891ac7a26`. Whole A682, Tasks10/11 and earlier unfinished duties remain open. This is not a partial production PR or finish/land readiness.

Authority: `docs/superpowers/plans/2026-10-17-a682-translations.md:213`–237 (bounded multilingual HTTP/client contracts, trimmed search, kind/id cursors and 100-cell retained reads), Task9 at487 (101st pending personal input/explicit capacity), Task10 at499 (window, filters, personal drafts, exact Save/late-answer behavior) and Task11 at514 (review/suggestions); approved spec closure at264 and the queue's 2026-10-05 changed-test decision. No fiscal, money, VAT, login, permission, drawer or root-guard expected value changes.

`test-map.json` records EVERY original standard `it` group with its exact old and current `file:line`, title and all matcher expressions. All37 original groups have a successor (43 runtime cases); the native-language redraw case expands to four theme/width cases, and one optional-two-language Save case is added, giving47 runtime cases. `assertion-audit.json` records every replaced/added/retained expression verbatim, including helper assertions. These are syntax inventories, not proof of fixture or behavior equivalence; use the matrix and actual runs together.

#### Changed test checks

All paths below are under `apps/dashboard/src/widgets/` unless qualified. `test-map.json` supplies exact final lines for each title, including all before/after expressions.

| Original check                                                                                                                                         | Current check and authority                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `content-translations-dialog.test.ts:90,121,152,183`: selected language in heading/table; literal replacement-pattern names/tags; completion sentences | Generic editor heading; exact selected Missing in labels and both optional language field labels; all original EN/ES/Valencian completion sentences and literal `$&` values remain. No required companion. Task10 / spec point4.                                                                                                                                                                                                                                                     |
| :221: passive multi-page opening and active language-scoped PUT                                                                                        | Exactly one passive bounded item query plus one suggestion query; active one-argument cell batch carries the same `Croqueta`, product and baseline facts, with explicit `language`/`field`. Contracts213–237 and Task10.                                                                                                                                                                                                                                                             |
| :251: stable table column objects and relabel on explicit redraw                                                                                       | Stable native field/input/value/caret on automatic EN→ES locale changes, all four light/dark ×390/1280 combinations; field and kind labels, suggestion prose/action, bounds and axe. There is no table column object in the new view. Task10 stable keyed native nodes; existing locale controller convention.                                                                                                                                                                       |
| :266: row101 disabled until an edit is undone                                                                                                          | One101st pending value is retained, native Save is disabled, zero writes, undo row099 then exact100-cell Save including `Último` and excluding099. Original ids are zero-padded for the kind/id cursor. Task9 explicitly permits the101st pending input and blocks Save.                                                                                                                                                                                                             |
| :310,323: 4096-byte limit, one send/native Enter                                                                                                       | Same byte-bound error, correction, native Enter, disabled busy field and one request; successful fake replies now contain the confirmed saved cell. No relaxed validation.                                                                                                                                                                                                                                                                                                           |
| :345,406: all nine editor addresses, parent labels, modifier/modified browser clicks                                                                   | All original address/label values and guarded product/variant events remain. Parent context was missing in the new window and is restored in production, not removed from expectations.                                                                                                                                                                                                                                                                                              |
| :440: Kind/Why/Search, multi-kind local filtering and shared no-match sentence                                                                         | Missing in/Kind/Search/Jump; one selected kind is sent to the server and returned rows render. Exact original Spanish no-matches sentence remains. Task10 deliberately removes Why and uses bounded server filters.                                                                                                                                                                                                                                                                  |
| :475: local search ranking, accent/multiword/trailing-space checks                                                                                     | Browser asserts exact raw query forwarding and returned order. `packages/catalogue/src/content-translation-pages.test.ts` adds REAL database checks for `IBERICO jamon`, `jam`, `jam `, `&`, whitespace. Plan213–220 explicitly trims search and uses kind/id order, so `jam ` now matches the same two rows as `jam`, and results use ids rather than fuzzy-rank order. Exact query values and expected real row ids are listed in the added database case; not just a mock search. |
| :496: mutable cached row reused after live rename                                                                                                      | Active server search is refreshed; the returned renamed staff row and personal `Mi pan` remain. A current-page replacement no longer promises a cached full-list row object. Task10 bounded replacement.                                                                                                                                                                                                                                                                             |
| :522: selected-only editor plus mandatory English companion                                                                                            | Exact Missing in/Jump initialization; blank optional English stays blank/nonrequired with staff placeholder; Spanish saves alone. Added separate two-cell Save retains original `Croqueta` and trimmed `Ham croquette` exact values. Spec points1/4 and closed SpanishA.                                                                                                                                                                                                             |
| :557: opening drains every page before editing                                                                                                         | Opening fetches one page of50; second page is requested explicitly and held; first draft stays readable during that read. Both exact `First`/`Last` edits survive into one batch. Task10 prohibits opening cursor drains.                                                                                                                                                                                                                                                            |
| :599: Kind/Why/context search hides a draft; Show edited restores it                                                                                   | Kind/Missing in/context query, exact returned item, edited/hidden counts, Show staged and same `Croqueta` Save. Why's intentional retirement is replaced by exact Missing in request assertions.                                                                                                                                                                                                                                                                                     |
| :641: hidden invalid required-default companion                                                                                                        | Hidden oversized UTF-8 name is revealed/focused, exact field error and bottom message, zero writes. Mandatory companion is removed by spec; the same recovery behavior remains.                                                                                                                                                                                                                                                                                                      |
| :664,696,713,723: field refusal/retry, empty/unavailable/error/retry, quiet reversion, native middle caret                                             | Same user behavior and values through the current cell API. The unavailable explanation was missing and is restored with its original localized sentence. Middle-edit case additionally checks exact trimmed wire value.                                                                                                                                                                                                                                                             |
| :738,774,792: held arrivals, explicit Keep/Replace/Discard and atomic page-two departures                                                              | Bounded page arrivals may display immediately, while the exact focused native draft remains mounted. Concurrent fills still block Save until choice; all original draft/current/latest-token values remain. Page-two config mismatch keeps old page/draft and does not apply a missing-cell reply; successful current reread then shows the missing draft, blocks Keep and explains unavailable. Task10/11 current page and field-specific review.                                   |
| :840,868,935,994,1035,1066,1105,1125,1169,1212: Save/reconnect/opening/review/passive races and exact retries                                          | Same lifecycle promises and literal draft/current/error values. Replies are delivered before assertions (one real animation frame for late answers). Current cell reads carry all four identity parts. A newer passive completion now invalidates the older explicit-read lock, while its delayed failure cannot release a newer review. Hidden conflicts retain separate old/current/draft panels.                                                                                  |
| :895: retained reference reads50+1                                                                                                                     | Current retained CELL endpoint accepts100: a review of51 drafts reads51 exact refs, then the restored empty-later-page fallback reads that same51 refs again with the first page. Exact two51-ref batches, all51 ids in each, all51 review panels and `Draft 50` retained. The second read follows the preserved automatic page recovery, not an opening scan. Contracts213–237 and original :1151 behavior.                                                                         |
| :1151: auto-return to populated page after live departures                                                                                             | Preserved. A current empty later page fetches the first bounded page once (four item reads total in the new explicit-navigation fixture), displays45 rows and disables both navigation directions. It does not require a new user click. New reader cases cover success, stale-refresh fencing and failed-read preservation.                                                                                                                                                         |

#### Fixture changes

- Every former `TranslationTarget`/single-language page fixture in the standard suite now supplies `TranslationItem`, projected `TranslationCell`, `configuration`, full four-part cell references and real query-bound cursors. Cell default/requested/staff facts remain separate. Known-canonical baselines are transparent fixture strings, never server validation substitutes.
- Successful Save doubles return the confirmed saved cells matching the submitted edits. An empty saved list means no confirmed field in the real model, so the old empty-success fixture no longer describes a complete save.
- Direct cell reads use the retained endpoint, with the current response token and unavailable/owner facts. Page-two removed-item fixtures now explicitly report those facts and preserve the former refusal assertions.
- `content-translations-pages.test.ts` only gains three cases; all existing matcher expressions remain. The added catalogue search case only adds assertions/rows; all prior assertions remain.
- The original accessibility state matrix is split into independently timed cases after the grouped run's screenshot reached its remaining deadline. Preserve every existing state/language/theme/width assertion and screenshot; All29 previous matcher expressions remain. The80 staged-state combinations now have separate deadlines, plus the four unchanged suggestion-matrix cases; final source477/candidate306 runs qualify it.

#### Evidence and limits

Qualified receipts are in the final verification/controls JSON and named logs. Earlier failures are retained in `qualification-notes.md`. Every deliberate omission is applied only in an independently frozen-installed disposable candidate, restored before the next run; the source worktree is never used for omission controls.

LOOK: eight complete standalone editor locale-change views plus eight unavailable-field views, EN/ES × light/dark × measured390/1280, copied under `look/` and inspected. Screenshots are Vitest-scaled raster outputs (e.g.312×720 for a390×900 CSS viewport), not1:1 pixel-paint probes or physical/full-app/server acceptance. The browser tests assert the actual CSS viewport/bounds, native input identity/selection, nonrequired state, and axe. Full Task13 acceptance remains open.

Keep this file, both audit JSONs, source-final.patch, qualification notes, controls and final receipts AND ALL prior A682 Changed test checks inventories in the eventual one PR. Existing venue folders still require the previously approved reset/reseed declaration in that PR's FIRST LINE; this continuation performs no reset/A760 execution. No whole-package coverage, readiness, final-review, push, PR, land or H12 duty is claimed.

Final evidence: `final-browser.log`477PASS/13files, `candidate-final-complete.log`306PASS/7files, `catalogue-search.log` and `candidate-catalogue-final.log`24PASS each, `root-final.log`37PASS, `protected.log`20PASS. Final dashboard types/scoped8-TS-file ESLint and Prettier/whitespace checks exited0 in tool session97834; `docs/backlog.md` is Prettier-ignored (confirmed via --file-info), so its own-entry prose was reviewed directly. Ten intended omission failures/restorations are in controls.json. Final all6713tracked paths match the installed candidate; qualified cwd probe found0holders and owned candidate/parent/registration are removed. All16 inspected images match current source screenshots byte-for-byte (look-final.json). Task10/11 and wholeA682 remain PARTIAL; original drafts/legacy retirement/reserved future preparation and final delivery remain.

## Checkpoint review

### A682 review/reveal continuation — changed checks

No existing test file, matcher or fixture changed in this continuation. The new content-translations-dialog.review.test.ts adds nineteen cases: field-specific old/current/draft, Keep/Replace/Discard, intentional clear, unavailable/disabled/changed-owner refusal, hidden invalid/refused native focus, unit abbreviation identity, 51st staged row and eight locale/theme/width layout-plus-axe cases. Authority: approved A682 design One Save/one transaction and plan Tasks10–11. Existing standard/drafts/a11y suites remain explicitly unmigrated; these additions do not claim their whole behavior is restored.

RED receipts: review-red.log (seven missing panels), reveal-red-qualified.log (two missing reveal behaviors), layout-red.log (eight overflow failures). Final source review-final.log nineteen pass; surrounding affected.log nine files298 pass preceded the strengthened two-field unit fixture, production unchanged. Candidate final four files147 pass includes that strengthened fixture. Six intended omission controls in controls.json each fail at an assertion and pass after restoration. No fiscal, money, permission, drawer or root-guard expectation changed. Retain all earlier A682 changed-check inventories for the eventual single PR.

## Checkpoint suggestions

A682 suggestion integration, based on signed271893a93.

No existing matcher or fixture was changed in this continuation. content-suggestions-bar.test.ts retains its whole previous body and adds one waiting-fixes-with-Cloud-off test. content-suggestions-bar.a11y.test.ts retains its whole previous body after removing only the two added waiting-fix states. New content-translations-dialog.fixes.test.ts exercises cell freshness, inherited overrides, personal text/clear priority, capacity, continuation, note rendering, discard, reopen and EN/ES/theme/width actions. See changed-existing-tests.json for the source-byte audit.

Carry every earlier A682 Changed test checks inventory into the eventual single PR; this audit does not replace them. No existing money, VAT, login, permission, cash-drawer, fiscal or root-guard expected value changed.

## Final audit 20261020

### Final audit changes to test data and fixtures

Owner English-only rule: scenario text is English; Spanish UI expectations use translation files. No matcher deleted, every numeric literal and expect count unchanged. Data/expected text renamed together, preserving distinct audience/language facts; accent search retains diacritics and multiword queries, byte limits retain é.

Additional fixture corrections: tabs.test.ts selected-variant customer key es-ES→es under optional-map canonical validation; units-api.test.ts measure cases gain required staffName/staffAbbreviation, every old assertion retained. suggestion-fixture.ts gains explicit optional bread customer map without changing its default, and two suites request English text.

Files:

- `apps/dashboard/src/api/client-translations.test.ts`
- `apps/dashboard/src/screens/catalogue-screen.test.ts`
- `apps/dashboard/src/screens/content-languages-screen.layout.test.ts`
- `apps/dashboard/src/screens/content-languages-screen.test.ts`
- `apps/dashboard/src/widgets/content-translations-dialog.a11y.test.ts`
- `apps/dashboard/src/widgets/content-translations-dialog.drafts.test.ts`
- `apps/dashboard/src/widgets/content-translations-dialog.fixes.test.ts`
- `apps/dashboard/src/widgets/content-translations-dialog.review.test.ts`
- `apps/dashboard/src/widgets/content-translations-dialog.test.ts`
- `apps/dashboard/src/widgets/content-translations-dialog.unsaved.test.ts`
- `apps/dashboard/src/widgets/content-translations-dialog.window.test.ts`
- `apps/dashboard/src/widgets/content-translations-model.multilingual.test.ts`
- `apps/dashboard/src/widgets/content-translations-model.test.ts`
- `apps/dashboard/src/widgets/content-translations-pages.test.ts`
- `apps/dashboard/src/widgets/content-translations-window.a11y.test.ts`
- `apps/dashboard/src/widgets/content-translations-window.test.ts`
- `apps/dashboard/src/widgets/include-folder-form.test.ts`
- `apps/dashboard/src/widgets/product-editor.test.ts`
- `apps/server/src/boot.test.ts`
- `apps/server/src/catalogue-api.test.ts`
- `apps/server/src/content-translations-api.test.ts`
- `apps/server/src/tabs.test.ts`
- `apps/server/src/units-api.test.ts`
- `apps/server/src/working-order.test.ts`
- `apps/till/src/widgets/modifier-picker.test.ts`
- `packages/catalogue/src/configuration-transfer.test.ts`
- `packages/catalogue/src/content-languages.test.ts`
- `packages/catalogue/src/content-suggestion-collect.job.test.ts`
- `packages/catalogue/src/content-suggestion-collect.test.ts`
- `packages/catalogue/src/content-suggestion-evidence.test.ts`
- `packages/catalogue/src/content-suggestion-paging.test.ts`
- `packages/catalogue/src/content-suggestion-store.test.ts`
- `packages/catalogue/src/content-translation-baseline.test.ts`
- `packages/catalogue/src/content-translation-cells.test.ts`
- `packages/catalogue/src/content-translation-gaps.test.ts`
- `packages/catalogue/src/content-translation-pages.test.ts`
- `packages/catalogue/src/content-translation-report.test.ts`
- `packages/catalogue/src/content-translation-save.test.ts`
- `packages/catalogue/src/content-translation-targets.test.ts`
- `packages/catalogue/src/content-translation-writes.test.ts`
- `packages/catalogue/src/content-translations.test.ts`
- `packages/catalogue/src/extra-presentation.test.ts`
- `packages/catalogue/src/menu-change-navigation.test.ts`
- `packages/catalogue/src/menu-publication.test.ts`
- `packages/catalogue/src/new-customer-text.test.ts`
- `packages/catalogue/src/optional-editor-maps.test.ts`
- `packages/catalogue/src/optional-translations.test.ts`
- `packages/catalogue/src/product-editor.test.ts`
- `packages/catalogue/src/product-presentation.test.ts`
- `packages/catalogue/src/sections.test.ts`
- `packages/catalogue/src/units.staff-identity.test.ts`
- `packages/catalogue/src/variants.test.ts`
- `packages/media/src/images.test.ts`

Full mapping scripts, raw failures, TypeScript literal/expect/numeric audit, baseline clones and final focused commands are in this receipt directory. Carry every earlier A682 inventory into the final PR.

## Final fixture field inventory

The following test and fixture files gain explicit unit staff fields or the separate raw extras
presentation facts. References point to their first added field in the candidate. These additions
supply the new contracts; the earlier sections describe any deliberately changed expectations.

| File                                                                         | First added field                                                               |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `apps/dashboard/src/api/client.test.ts`                                      | `apps/dashboard/src/api/client.test.ts:723`                                     |
| `apps/dashboard/src/dashboard-app.test.ts`                                   | `apps/dashboard/src/dashboard-app.test.ts:1530`                                 |
| `apps/dashboard/src/screens/catalogue-screen.a11y.test.ts`                   | `apps/dashboard/src/screens/catalogue-screen.a11y.test.ts:42`                   |
| `apps/dashboard/src/screens/catalogue-screen.test.ts`                        | `apps/dashboard/src/screens/catalogue-screen.test.ts:57`                        |
| `apps/dashboard/src/screens/menus-screen.home-tab.test.ts`                   | `apps/dashboard/src/screens/menus-screen.home-tab.test.ts:45`                   |
| `apps/dashboard/src/screens/menus-screen.test.ts`                            | `apps/dashboard/src/screens/menus-screen.test.ts:106`                           |
| `apps/dashboard/src/screens/modifiers-screen.test.ts`                        | `apps/dashboard/src/screens/modifiers-screen.test.ts:62`                        |
| `apps/dashboard/src/screens/recipe-screen.a11y.test.ts`                      | `apps/dashboard/src/screens/recipe-screen.a11y.test.ts:46`                      |
| `apps/dashboard/src/screens/recipe-screen.test.ts`                           | `apps/dashboard/src/screens/recipe-screen.test.ts:47`                           |
| `apps/dashboard/src/screens/recipe-screen.unsaved.test.ts`                   | `apps/dashboard/src/screens/recipe-screen.unsaved.test.ts:69`                   |
| `apps/dashboard/src/screens/unit-owners.unsaved.test.ts`                     | `apps/dashboard/src/screens/unit-owners.unsaved.test.ts:85`                     |
| `apps/dashboard/src/screens/units-reassignment.unsaved.test.ts`              | `apps/dashboard/src/screens/units-reassignment.unsaved.test.ts:36`              |
| `apps/dashboard/src/screens/units-screen.a11y.test.ts`                       | `apps/dashboard/src/screens/units-screen.a11y.test.ts:24`                       |
| `apps/dashboard/src/screens/units-screen.test.ts`                            | `apps/dashboard/src/screens/units-screen.test.ts:32`                            |
| `apps/dashboard/src/state/product-child-create.test.ts`                      | `apps/dashboard/src/state/product-child-create.test.ts:40`                      |
| `apps/dashboard/src/widgets/catalogue-browser.a11y.test.ts`                  | `apps/dashboard/src/widgets/catalogue-browser.a11y.test.ts:24`                  |
| `apps/dashboard/src/widgets/catalogue-browser.test.ts`                       | `apps/dashboard/src/widgets/catalogue-browser.test.ts:50`                       |
| `apps/dashboard/src/widgets/catalogue-forms.unsaved.test.ts`                 | `apps/dashboard/src/widgets/catalogue-forms.unsaved.test.ts:23`                 |
| `apps/dashboard/src/widgets/device-home-preview.test.ts`                     | `apps/dashboard/src/widgets/device-home-preview.test.ts:26`                     |
| `apps/dashboard/src/widgets/extra-list-form.a11y.test.ts`                    | `apps/dashboard/src/widgets/extra-list-form.a11y.test.ts:29`                    |
| `apps/dashboard/src/widgets/extra-list-form.save-state.test.ts`              | `apps/dashboard/src/widgets/extra-list-form.save-state.test.ts:22`              |
| `apps/dashboard/src/widgets/extra-list-form.test.ts`                         | `apps/dashboard/src/widgets/extra-list-form.test.ts:42`                         |
| `apps/dashboard/src/widgets/menu-structure-table.test.ts`                    | `apps/dashboard/src/widgets/menu-structure-table.test.ts:31`                    |
| `apps/dashboard/src/widgets/product-details.test.ts`                         | `apps/dashboard/src/widgets/product-details.test.ts:68`                         |
| `apps/dashboard/src/widgets/product-editor.a11y.test.ts`                     | `apps/dashboard/src/widgets/product-editor.a11y.test.ts:166`                    |
| `apps/dashboard/src/widgets/product-editor.save-state.test.ts`               | `apps/dashboard/src/widgets/product-editor.save-state.test.ts:99`               |
| `apps/dashboard/src/widgets/product-editor.test.ts`                          | `apps/dashboard/src/widgets/product-editor.test.ts:99`                          |
| `apps/dashboard/src/widgets/product-list.a11y.test.ts`                       | `apps/dashboard/src/widgets/product-list.a11y.test.ts:31`                       |
| `apps/dashboard/src/widgets/product-list.test.ts`                            | `apps/dashboard/src/widgets/product-list.test.ts:175`                           |
| `apps/dashboard/src/widgets/recipe-editor.a11y.test.ts`                      | `apps/dashboard/src/widgets/recipe-editor.a11y.test.ts:41`                      |
| `apps/dashboard/src/widgets/recipe-editor.save-state.test.ts`                | `apps/dashboard/src/widgets/recipe-editor.save-state.test.ts:35`                |
| `apps/dashboard/src/widgets/recipe-editor.test.ts`                           | `apps/dashboard/src/widgets/recipe-editor.test.ts:38`                           |
| `apps/dashboard/src/widgets/unit-form.a11y.test.ts`                          | `apps/dashboard/src/widgets/unit-form.a11y.test.ts:19`                          |
| `apps/dashboard/src/widgets/unit-form.save-state.test.ts`                    | `apps/dashboard/src/widgets/unit-form.save-state.test.ts:15`                    |
| `apps/dashboard/src/widgets/unit-form.staff-identity.test.ts`                | `apps/dashboard/src/widgets/unit-form.staff-identity.test.ts:18`                |
| `apps/dashboard/src/widgets/unit-form.test.ts`                               | `apps/dashboard/src/widgets/unit-form.test.ts:70`                               |
| `apps/server/src/cancel-invoiced-order.test.ts`                              | `apps/server/src/cancel-invoiced-order.test.ts:89`                              |
| `apps/server/src/catalogue-manage-permission.test.ts`                        | `apps/server/src/catalogue-manage-permission.test.ts:61`                        |
| `apps/server/src/configuration-transfer.test.ts`                             | `apps/server/src/configuration-transfer.test.ts:7220`                           |
| `apps/server/src/content-translations-api.test.ts`                           | `apps/server/src/content-translations-api.test.ts:130`                          |
| `apps/server/src/issue-moment.test.ts`                                       | `apps/server/src/issue-moment.test.ts:28`                                       |
| `apps/server/src/kitchen-print.test.ts`                                      | `apps/server/src/kitchen-print.test.ts:1080`                                    |
| `apps/server/src/modifier-selection.test.ts`                                 | `apps/server/src/modifier-selection.test.ts:176`                                |
| `apps/server/src/modifier-selection.unit-fallback.test.ts`                   | `apps/server/src/modifier-selection.unit-fallback.test.ts:9`                    |
| `apps/server/src/move-merge.test.ts`                                         | `apps/server/src/move-merge.test.ts:102`                                        |
| `apps/server/src/order-groups.test.ts`                                       | `apps/server/src/order-groups.test.ts:4111`                                     |
| `apps/server/src/receipt-language.test.ts`                                   | `apps/server/src/receipt-language.test.ts:787`                                  |
| `apps/server/src/recipe-api.test.ts`                                         | `apps/server/src/recipe-api.test.ts:58`                                         |
| `apps/server/src/tabs.test.ts`                                               | `apps/server/src/tabs.test.ts:2953`                                             |
| `apps/server/src/testing/seed-units.ts`                                      | `apps/server/src/testing/seed-units.ts:16`                                      |
| `apps/server/src/till-api.sell-published.test.ts`                            | `apps/server/src/till-api.sell-published.test.ts:674`                           |
| `apps/server/src/till-sale.test.ts`                                          | `apps/server/src/till-sale.test.ts:1074`                                        |
| `apps/server/src/units-api.test.ts`                                          | `apps/server/src/units-api.test.ts:86`                                          |
| `apps/server/src/working-order.customer-fallback.test.ts`                    | `apps/server/src/working-order.customer-fallback.test.ts:45`                    |
| `apps/server/src/working-order.test.ts`                                      | `apps/server/src/working-order.test.ts:159`                                     |
| `apps/till/src/api/client.test.ts`                                           | `apps/till/src/api/client.test.ts:4821`                                         |
| `apps/till/src/screens/till-counter-cleanup.look.test.ts`                    | `apps/till/src/screens/till-counter-cleanup.look.test.ts:121`                   |
| `apps/till/src/screens/till-table-order-screen.a11y.test.ts`                 | `apps/till/src/screens/till-table-order-screen.a11y.test.ts:281`                |
| `apps/till/src/screens/till-table-order-screen.new-order-quantities.test.ts` | `apps/till/src/screens/till-table-order-screen.new-order-quantities.test.ts:86` |
| `apps/till/src/screens/till-table-order-screen.preview-unsaved.test.ts`      | `apps/till/src/screens/till-table-order-screen.preview-unsaved.test.ts:24`      |
| `apps/till/src/screens/till-table-order-screen.test.ts`                      | `apps/till/src/screens/till-table-order-screen.test.ts:3039`                    |
| `apps/till/src/screens/till-table-order-screen.unavailable.test.ts`          | `apps/till/src/screens/till-table-order-screen.unavailable.test.ts:28`          |
| `apps/till/src/state/as-served-diet.test.ts`                                 | `apps/till/src/state/as-served-diet.test.ts:8`                                  |
| `apps/till/src/state/draft-lines.test.ts`                                    | `apps/till/src/state/draft-lines.test.ts:31`                                    |
| `apps/till/src/state/held-extras.test.ts`                                    | `apps/till/src/state/held-extras.test.ts:8`                                     |
| `apps/till/src/state/menu-refresh.test.ts`                                   | `apps/till/src/state/menu-refresh.test.ts:10`                                   |
| `apps/till/src/state/order-line.test.ts`                                     | `apps/till/src/state/order-line.test.ts:24`                                     |
| `apps/till/src/state/working-order.customer-fallback.test.ts`                | `apps/till/src/state/working-order.customer-fallback.test.ts:30`                |
| `apps/till/src/state/working-order.test.ts`                                  | `apps/till/src/state/working-order.test.ts:978`                                 |
| `apps/till/src/till-app-boot-and-counter.test.ts`                            | `apps/till/src/till-app-boot-and-counter.test.ts:4214`                          |
| `apps/till/src/till-app-device-zones.test.ts`                                | `apps/till/src/till-app-device-zones.test.ts:107`                               |
| `apps/till/src/till-app-drafts.test.ts`                                      | `apps/till/src/till-app-drafts.test.ts:53`                                      |
| `apps/till/src/till-app-menu-refresh.test.ts`                                | `apps/till/src/till-app-menu-refresh.test.ts:34`                                |
| `apps/till/src/till-app-menu-timetable.test.ts`                              | `apps/till/src/till-app-menu-timetable.test.ts:30`                              |
| `apps/till/src/till-app-open-table.test.ts`                                  | `apps/till/src/till-app-open-table.test.ts:33`                                  |
| `apps/till/src/till-app-setup-refresh.test.ts`                               | `apps/till/src/till-app-setup-refresh.test.ts:34`                               |
| `apps/till/src/till-app.test.ts`                                             | `apps/till/src/till-app.test.ts:6445`                                           |
| `apps/till/src/widgets/basket-recalled.test.ts`                              | `apps/till/src/widgets/basket-recalled.test.ts:41`                              |
| `apps/till/src/widgets/basket-refresh-dialog.test.ts`                        | `apps/till/src/widgets/basket-refresh-dialog.test.ts:28`                        |
| `apps/till/src/widgets/basket.a11y.test.ts`                                  | `apps/till/src/widgets/basket.a11y.test.ts:170`                                 |
| `apps/till/src/widgets/basket.line-details.atomic.test.ts`                   | `apps/till/src/widgets/basket.line-details.atomic.test.ts:22`                   |
| `apps/till/src/widgets/basket.line-details.look.test.ts`                     | `apps/till/src/widgets/basket.line-details.look.test.ts:32`                     |
| `apps/till/src/widgets/basket.line-details.test.ts`                          | `apps/till/src/widgets/basket.line-details.test.ts:51`                          |
| `apps/till/src/widgets/basket.test.ts`                                       | `apps/till/src/widgets/basket.test.ts:29`                                       |
| `apps/till/src/widgets/last-added.test.ts`                                   | `apps/till/src/widgets/last-added.test.ts:64`                                   |
| `apps/till/src/widgets/menu-browser.a11y.test.ts`                            | `apps/till/src/widgets/menu-browser.a11y.test.ts:24`                            |
| `apps/till/src/widgets/menu-browser.home-columns.test.ts`                    | `apps/till/src/widgets/menu-browser.home-columns.test.ts:70`                    |
| `apps/till/src/widgets/menu-browser.test.ts`                                 | `apps/till/src/widgets/menu-browser.test.ts:22`                                 |
| `apps/till/src/widgets/modifier-picker.a11y.test.ts`                         | `apps/till/src/widgets/modifier-picker.a11y.test.ts:11`                         |
| `apps/till/src/widgets/modifier-picker.quantity.test.ts`                     | `apps/till/src/widgets/modifier-picker.quantity.test.ts:102`                    |
| `apps/till/src/widgets/modifier-picker.save-state.test.ts`                   | `apps/till/src/widgets/modifier-picker.save-state.test.ts:14`                   |
| `apps/till/src/widgets/modifier-picker.test.ts`                              | `apps/till/src/widgets/modifier-picker.test.ts:33`                              |
| `apps/till/src/widgets/modifier-picker.unsaved.test.ts`                      | `apps/till/src/widgets/modifier-picker.unsaved.test.ts:64`                      |
| `apps/till/src/widgets/payment-leading-zeros.test.ts`                        | `apps/till/src/widgets/payment-leading-zeros.test.ts:228`                       |
| `apps/till/src/widgets/product-name.test.ts`                                 | `apps/till/src/widgets/product-name.test.ts:134`                                |
| `apps/till/src/widgets/tender-pay-enter-key.test.ts`                         | `apps/till/src/widgets/tender-pay-enter-key.test.ts:12`                         |
| `apps/till/src/widgets/tender-pay-idle-choices.test.ts`                      | `apps/till/src/widgets/tender-pay-idle-choices.test.ts:12`                      |
| `apps/till/src/widgets/tender-pay-weighed-dish.test.ts`                      | `apps/till/src/widgets/tender-pay-weighed-dish.test.ts:14`                      |
| `apps/till/src/widgets/tender-pay.test.ts`                                   | `apps/till/src/widgets/tender-pay.test.ts:16`                                   |
| `apps/till/src/widgets/tender-pay.unsaved.test.ts`                           | `apps/till/src/widgets/tender-pay.unsaved.test.ts:21`                           |
| `packages/catalogue/src/active-available.test.ts`                            | `packages/catalogue/src/active-available.test.ts:35`                            |
| `packages/catalogue/src/configuration-transfer.test.ts`                      | `packages/catalogue/src/configuration-transfer.test.ts:462`                     |
| `packages/catalogue/src/content-languages.test.ts`                           | `packages/catalogue/src/content-languages.test.ts:48`                           |
| `packages/catalogue/src/content-languages.valencian.test.ts`                 | `packages/catalogue/src/content-languages.valencian.test.ts:24`                 |
| `packages/catalogue/src/content-suggestion-collect.job.test.ts`              | `packages/catalogue/src/content-suggestion-collect.job.test.ts:367`             |
| `packages/catalogue/src/content-suggestion-collect.test.ts`                  | `packages/catalogue/src/content-suggestion-collect.test.ts:218`                 |
| `packages/catalogue/src/content-suggestion-evidence.test.ts`                 | `packages/catalogue/src/content-suggestion-evidence.test.ts:228`                |
| `packages/catalogue/src/content-translation-baseline.test.ts`                | `packages/catalogue/src/content-translation-baseline.test.ts:355`               |
| `packages/catalogue/src/content-translation-cells.test.ts`                   | `packages/catalogue/src/content-translation-cells.test.ts:45`                   |
| `packages/catalogue/src/content-translation-gaps.test.ts`                    | `packages/catalogue/src/content-translation-gaps.test.ts:95`                    |
| `packages/catalogue/src/content-translation-pages.test.ts`                   | `packages/catalogue/src/content-translation-pages.test.ts:80`                   |
| `packages/catalogue/src/content-translation-report.test.ts`                  | `packages/catalogue/src/content-translation-report.test.ts:220`                 |
| `packages/catalogue/src/content-translation-save.test.ts`                    | `packages/catalogue/src/content-translation-save.test.ts:108`                   |
| `packages/catalogue/src/content-translation-targets.test.ts`                 | `packages/catalogue/src/content-translation-targets.test.ts:107`                |
| `packages/catalogue/src/content-translation-writes.test.ts`                  | `packages/catalogue/src/content-translation-writes.test.ts:126`                 |
| `packages/catalogue/src/content-translations.test.ts`                        | `packages/catalogue/src/content-translations.test.ts:131`                       |
| `packages/catalogue/src/customer-menu-presentation.test.ts`                  | `packages/catalogue/src/customer-menu-presentation.test.ts:161`                 |
| `packages/catalogue/src/extra-projection.test.ts`                            | `packages/catalogue/src/extra-projection.test.ts:105`                           |
| `packages/catalogue/src/extra-usage.test.ts`                                 | `packages/catalogue/src/extra-usage.test.ts:52`                                 |
| `packages/catalogue/src/extras.test.ts`                                      | `packages/catalogue/src/extras.test.ts:113`                                     |
| `packages/catalogue/src/integration.test.ts`                                 | `packages/catalogue/src/integration.test.ts:97`                                 |
| `packages/catalogue/src/menu-change-navigation.test.ts`                      | `packages/catalogue/src/menu-change-navigation.test.ts:76`                      |
| `packages/catalogue/src/menu-document.test.ts`                               | `packages/catalogue/src/menu-document.test.ts:1190`                             |
| `packages/catalogue/src/menu-publication.test.ts`                            | `packages/catalogue/src/menu-publication.test.ts:78`                            |
| `packages/catalogue/src/migrations.test.ts`                                  | `packages/catalogue/src/migrations.test.ts:424`                                 |
| `packages/catalogue/src/offered-modifiers.test.ts`                           | `packages/catalogue/src/offered-modifiers.test.ts:31`                           |
| `packages/catalogue/src/operations.test.ts`                                  | `packages/catalogue/src/operations.test.ts:197`                                 |
| `packages/catalogue/src/pricing.dated.test.ts`                               | `packages/catalogue/src/pricing.dated.test.ts:37`                               |
| `packages/catalogue/src/pricing.test.ts`                                     | `packages/catalogue/src/pricing.test.ts:20`                                     |
| `packages/catalogue/src/product-editor.test.ts`                              | `packages/catalogue/src/product-editor.test.ts:36`                              |
| `packages/catalogue/src/provisioning.test.ts`                                | `packages/catalogue/src/provisioning.test.ts:280`                               |
| `packages/catalogue/src/unit-presentation.test.ts`                           | `packages/catalogue/src/unit-presentation.test.ts:7`                            |
| `packages/catalogue/src/units.db.test.ts`                                    | `packages/catalogue/src/units.db.test.ts:60`                                    |
| `packages/catalogue/src/units.operations.test.ts`                            | `packages/catalogue/src/units.operations.test.ts:73`                            |
| `packages/catalogue/src/units.staff-identity.test.ts`                        | `packages/catalogue/src/units.staff-identity.test.ts:12`                        |
| `packages/catalogue/src/units.staff-projection.test.ts`                      | `packages/catalogue/src/units.staff-projection.test.ts:27`                      |
| `packages/catalogue/src/variant-fallback.test.ts`                            | `packages/catalogue/src/variant-fallback.test.ts:90`                            |
| `packages/catalogue/src/variants.db.test.ts`                                 | `packages/catalogue/src/variants.db.test.ts:65`                                 |
| `packages/catalogue/src/variants.test.ts`                                    | `packages/catalogue/src/variants.test.ts:48`                                    |
| `packages/catalogue/test/fixtures.ts`                                        | `packages/catalogue/test/fixtures.ts:115`                                       |
| `packages/media/src/images.test.ts`                                          | `packages/media/src/images.test.ts:1241`                                        |
| `packages/recipes/test/fixtures.ts`                                          | `packages/recipes/test/fixtures.ts:41`                                          |
| `packages/venue-service/src/category-dependencies.test.ts`                   | `packages/venue-service/src/category-dependencies.test.ts:133`                  |
| `packages/venue-service/src/department-transfers.test.ts`                    | `packages/venue-service/src/department-transfers.test.ts:962`                   |
| `packages/venue-service/src/kitchen-notices.test.ts`                         | `packages/venue-service/src/kitchen-notices.test.ts:413`                        |

## Final Claude review follow-up, 2026-10-20

The review at `f1bf61f` found that a unit-name-only change produced an extras preview entry
carrying only abbreviation and precision. The name-only catalogue case now adds exact
before/after name and staff-pair checks while retaining its earlier kind/product check.
`menu-document.test.ts`, `menu-change-navigation.test.ts`, `menu-preview.test.ts` and
`menu-preview-tree.test.ts` gain the required name/staff fields in their existing unit-change
fixtures. All prior values and assertions remain. The new browser suite covers the distinct
labels, staff fallback and an honest details-changed notice when the displayed labels match,
in both languages/themes at phone and desktop widths. Authority: Task 12's future full unit
context and Task 13's preview acceptance, plus review finding 1.

`content-translation-writes.test.ts` adds an independent mismatched-owner case with unchanged
cell identities and complete before/after aggregates. This qualifies the existing owner-kind
guard; production validation is unchanged. Removing just that check in the installed candidate
makes the new test fail, while the restored full suite passes. The previous wrong-product case
also changed the cell kind and therefore did not isolate this guard.

The raw Save/normalized-map byte-limit difference is retained and documented in
[products.md](../developers/products.md#the-translation-gap-report). A disposable real-database
probe uses a valid cell baseline: 4098 raw bytes with surrounding spaces are refused without
writes; the trimmed 4096-byte value succeeds. Raising only the raw gate makes the refusal
assertion fail. The ordinary map helper accepts the trimmed value. This records two layer
boundaries, not a larger editor limit.

## Current-head CI follow-up, 2026-10-20

Run `39400077906` on `f69b0e95099f7aeae5a4a967a14cd7b77fe77c2a` failed in
server setup and one unit-screen assertion. The captured logs identify each repair below.
No fiscal test, fiscal writer, money/VAT assertion or root guard was edited for these failures.

- `apps/server/src/testing/adjustment-venue.ts`: the wine-glass variant's customer map key
  changes from `es-ES` to canonical `es`. Its text, prices, locale argument and all other facts
  stay the same. Five suites reproduced the setup refusal; all 24 fixture consumers then passed
  (787 cases). This is the ordinary map validation from Task 4.
- `apps/server/src/till-sale.test.ts`: the double variant's customer map makes the same
  `es-ES` to `es` key correction. All existing variant sale/receipt assertions stay intact.
- `apps/server/src/attendance-orders.test.ts`: four list/label customer-map keys make that
  same correction. The existing credit, time, activity and rollback checks stay intact.
- `apps/dashboard/src/screens/units-screen.test.ts`: the measure-switch save's exact body
  gains `staffName: "Staff unit"` and `staffAbbreviation: "su"`, required by unit option A /
  Tasks 2–3. Every earlier field/value stays the same. Observed one assertion failure before;
  all 80 unit-screen cases pass after.

CI also exposed redundant staff fallback copies in newly prepared option answers. The frozen
staff fields already supply the absent-customer fallback through the unchanged customer reader.
Server/till preparation now retains `null` for an absent customer map; a present map still resolves
its requested/default/staff value. This retains the historical representation without changing
customer wording or adding a catalogue lookup. Authority: Task 12's preparation-only scope and
unchanged fiscal/recorded-reader boundary.

`modifier-selection.test.ts` restores its original main-branch "keeps a missing customer map
missing" case and both `toBeNull` assertions. A separate new complete-snapshot case also checks
the actual customer label under another requested language. It failed on the redundant copies
before the production correction. `held-options.test.ts` retains the original new fallback cases,
adds an all-null case and checks the same readable labels; absent maps now expect `null`, while
present-map and staff/display expectations remain. Two cases failed before the till correction.
The existing `till-api.fiscal-sale-paths.test.ts` stays byte-identical to the pushed candidate,
including its exact original null maps, receipt/replay facts, all totals and fiscal assertions.
The protected golden/immutability suites also pass unchanged (20 cases).


### Allergy integration fixture after rebase

The rebase onto #1910 adds `apps/till/test/allergy-app-fixture.ts`, whose unit fixture predates
A682's required staff pair. The normal hook and a focused till typecheck both refused its
`SellableUnit` at line 45 (`TS2739`, missing `staffName` and `staffAbbreviation`). The fixture
gains only `staffName: "Staff unit"` and `staffAbbreviation: "su"`; its original id, translated
maps, price/precision/hardware values and all consumer assertions remain unchanged. Authority:
unit option A / Tasks 2–3. The six consuming allergy suites are run after this addition. No
production behavior or allergy contract is changed.
