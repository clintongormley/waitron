# A682: optional translations, one editor, deliberate saves

**Current status (2026-10-17, after 16:25): unit option A is approved.** Full design approval,
implementation and the detailed plan await only the Spanish-text conflict in the
[reconciliation addendum](#2026-10-17-reconciliation-spanish-and-approved-unit-option-a).
The original proposal below is preserved as history, including its superseded pending unit question
and initial status. The addendum records the current decisions and author's recommendation.

**Status: NOT APPROVED. Product implementation and its detailed plan wait for the units choice below.** Design only, based on source
at `6a4331b4d5e038ecdfc482318eaa6c9e5a5abefe`, read on 2026-10-17. Recommendations below are proposals, not owner approval.
The existing default-switch test passed unchanged: `pnpm --filter @waitron/catalogue exec vitest run src/content-languages.test.ts
-t 'refuses to change the default while a unit lacks its translation'` (1 passed, 28 skipped). It asserts today's refusal, not this design.

You should be able to leave customer wording blank, see exactly which translations are missing, and compare languages while
reviewing Translate all. A fallback makes a name readable; it does not make that language translated. Deliver all five A682 points
and Use fix in **one future PR**.

## Current source facts

- `packages/catalogue/src/schema/units.ts:10` and `product-types.ts:31` hold only language maps for a unit's name and abbreviation.
  `units.ts` → `requireTranslations` checks both supplied maps against the default language;
  `apps/dashboard/src/widgets/unit-form.ts` → `#validate` requires both values in `locales[0]`. Neither defines a
  language-independent staff fallback.
- Other customer fields already allow absence: `packages/db/src/schema/catalogue.ts:79`, `packages/catalogue/src/schema/options.ts`,
  `schema/extras.ts`, and `schema/sections.ts:36`. Sections use `{}`. Making their translations optional does not inherently require
  a migration.
- `content-languages.ts` → `writeContentLanguages` caps languages at 200, enforces required-enabled languages and gates default
  changes on catalogue/contributed gaps (`apps/server/src/boot.ts:1814`).
- `content-translation-report.ts` → `listTranslationGapReport` omits wholly absent default-language names and absent extras-list
  names. `content-translation-targets.ts` → `blankIn` has related omissions. `resolved` permits direct archived product/variant
  targets; `LIVE_CANDIDATE` excludes them from discovery.
- `content-translation-types.ts` → `TranslationEdit` has no language member. The language comes from `GET/PUT
/management-api/content-translations/:language`. `content-translations.ts` → `checkedBatch` accepts 1–100 unique item edits,
  nonblank text, and an optional default companion. `saveContentTranslations` checks every baseline before writing and accepts a
  retry only when the whole batch matches its projected final state. The HTTP body bound is 262,144 bytes.
- `apps/dashboard/src/widgets/content-translations-model.ts` → `personalSubmission` excludes untouched suggestions from the leave
  guard. The dialog's `#scan` follows every cursor; `render` displays 50 rows.
- `packages/catalogue/src/content-suggestion-store.ts` → `suggestionStale` compares item/language, owners and
  selected/effective/inherited text, not the whole configuration token. Fix rows are stored with `expected: null`;
  `listContentSuggestions` computes `stale` only for rows with text. `validFix` admits `internal` or an entered language, never a
  missing-language replacement.
- `customerPresentationText` in `product-presentation.ts` falls back to staff only for a wholly blank map.
  `default-language-text.ts` uses `resolveSnapshotText`, which can choose another stored language. `customer-menu-presentation.ts` →
  `resolveMenuText` already resolves requested, default, then staff. Validation alone does not align these consumers.

Paths without a directory in this facts section are under `packages/catalogue/src/`. Conventions read under `docs/developers/`:
`products.md`, `conventions-ui.md`, `design-system.md` (Forms and Content languages), `conventions-data.md` and `writing-claims.md`.
This supplements Translate all design §6 and plan Decisions 1–6: revise 1/5/6; preserve 2–4.

## One owner decision: what remains when a unit has no translations?

**For a Spanish-only unit `name={es: "Kilogramo"}`, `abbreviation={es: "kg"}`, should you be able to make English the default and
then clear every translated name and abbreviation: A, with a required separate staff name and abbreviation (recommended), or B,
retaining at least one translated name and one translated abbreviation?**

| Choice                                                                                                   | English becomes default, Spanish remains                                                                                                                                             | You clear every translation                                                                                                                             |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A, recommended:** required language-independent staff name and abbreviation; all translations optional | With staff values `Kilogramo` / `kg`, staff lists try dashboard language, content default, then staff. Future customer receipts freeze the default abbreviation or staff `kg`.       | Allowed. Staff lists still show `Kilogramo` / `kg`; future receipts still show `kg`. Each enabled language reports missing translated values.           |
| **B:** each map retains at least one nonblank translation                                                | Staff lists try dashboard/default, then the first nonblank stored language by sorted canonical code: Spanish here. Future receipts freeze default, then that deterministic fallback. | Refused atomically, preserving the last saved values. To remove Spanish, enter replacements first. This is an explicit exception to “nothing required”. |

Today `writeContentLanguages` refuses that switch over the unit's missing English name. Under A you explicitly supply the staff pair
when creating/editing a unit; do not silently promote a translation, invent a staff label, or treat either choice as approved. A
needs new unit columns and their projections; B may need validation/resolution changes only. Neither changes precision, Each
identity or `hardwareUnit`; editable abbreviations never determine scale behavior. The exact schema, request shape and
initialization/reset details wait for this choice. A gives you a stable fallback when every translated value is blank, following
the product naming pattern; B retains a customer language solely to supply that fallback.

## Proposed behavior for the five points

1. **Optional customer wording.** Accept partial maps and clearing their last entry. Keep map/key, type and size validation separate
   from completeness. For live customer text use requested enabled language, then default, then that item's staff name; product and
   variant resolve independently. Kitchen and staff product names keep their own audiences. Unit rules remain conditional above.
   Show fallback as a placeholder, never save it as a translation. Existing disabled-language text stays stored; patch only
   explicitly edited enabled fields.
2. **Every missing value.** Count each eligible item once per enabled language when its translated name is blank, including the
   default, null/empty maps and absent extras-list names. Counts do not shrink because a fallback exists or a suggestion is staged.
   Preserve discovery's activity, role and ownership rules. An include without its own overrides is represented by its included
   menu; an overriding include checks the effective inherited-plus-own map. Inheritance containing actual text satisfies that
   language. Clearing an override removes it and reveals inheritance. Author call: a unit row shows both name and abbreviation,
   flags either missing, and counts once per language. Translate all continues suggesting unit **names** only; abbreviations are
   manual. Kinds: product, variant, options list, options label, extras list, menu, section, included menu, unit.
3. **Free default choice.** Remove the missing-text refusal on a default switch, including contributed image gaps. Keep canonical
   codes, uniqueness, default membership, 200-language bound and regional required-enabled checks. This does not relax image
   metadata's own write validation. Do not weaken the shared strict validator globally: `packages/media/src/images.ts` →
   `validateImageMetadata` also calls it. Changing default neither rewrites translations nor recorded snapshots.
4. **One editor across languages.** Every language row's Edit translations opens the same editor, with that row's language initially
   selected in **Missing in…**. Keep Kind and Search. Author call: Missing in offers Any language, one enabled language, and All
   names; All names removes the gap restriction so you can correct complete rows. Rows expose one logical field per enabled language
   (two for units), including filled values; Why and the required-default companion disappear. A waiting-fixes action reveals
   complete rows in All names, including fixes whose rows the initial Missing in filter hides. State that filter change explicitly.
   Edits remain staged across filters, pages and language scrolling, with visible counts and Show staged to reveal hidden changes.
5. **Readable regional notes.** Wrap the full note at phone and desktop widths using the screen's `::part(language-meta)` and table
   `wrap-to-fit` support (`wt-data-table.ts:986`). Keep Actions pinned.

Author layout call: retain pages of at most 50 items and window the language columns, with a searchable language jump control.
Render only the visible columns plus a small buffer; on phones stack the visible fields. All 200 languages remain reachable, with no
smaller content-language cap. Keep the focused field mounted until focus moves. Fetch only bounded pages and visible language
projections, plus retained draft/fix targets; do not scan all pages in all languages at opening. Read suggestions in pages of at
most 100. Require advancing cursors and consistent configuration. Use shared fields, semantic names, language tags and `--wt-*`
tokens.

## One Save, one transaction

Evolve the translation route family and model to submit changed item/language/field cells together. Keep the existing optimistic
`expected` facts (saved text, inheritance, owner/role, activity, configuration and required languages); extend their field identity
for unit abbreviations. Do not replace them with “last write wins”. The precise payload is deferred, not a guessed new interface.

Author batching call: at most **100 changed cells**, within the existing HTTP byte bound, per deliberate Save. Show the staged
count, including hidden cells and suggestion fills. At capacity, let you unstage untouched suggestions or deliberately finish this
batch before starting another; never silently split a Save into language requests, truncate it or commit the first 100 edits. A
large single-row edit still needs explicit batch selection, never an implicit 100-language cap. Clearing is a real edit; represent
removal explicitly and retain all other language keys.

Resolve all cells from one transaction snapshot, combine each item's changes, project root/include dependencies against their final
maps, validate everything, then write each merged map and delete only the corresponding saved suggestions in that transaction. Any
refusal rolls everything back. Preserve whole-batch idempotent retry: every baseline matches, or every submitted final state
matches; a mixture is a conflict. Retain the exact submitted batch after an uncertain reply. Live refresh keeps personal edits,
including intentional blanks. Keep old/current/draft review and Keep/Replace/Discard; Keep cannot accept a changed owner or an
unavailable target. A changed default, disabled edited language, removed target or replaced ownership needs explicit review, not
draft loss. Retain direct archived product/variant translation edits while discovery and automatic suggestions exclude them. Use
passive reads and opening-generation checks. Commit the submitted draft after a successful write; a later report-refresh failure is
a load failure, never a failed Save.

## Translate all and Use fix

All fresh translation suggestions enter this editor's exact language field as Suggested drafts, only if saved text and personal
draft are empty and the person has not deliberately cleared it. Manual values, intentional blanks and staged fixes survive later
arrivals. Untouched suggestions stay on the box and do not prompt on close; Save may open ready. Personal edits and Use fix do
prompt. Capacity leaves remaining suggestions waiting.

For a language spelling fix, re-resolve the exact target and compare its entered text to `wrong`, with eligibility, owner and
inherited-value checks. Author call: retain a language-field baseline for fixes at collection only when the current text equals
`wrong`, using nullable `expected` (`schema/suggestions.ts`); recheck on listing/staging. Fixes without that evidence are notes
only. Adding an unrelated language alone must not stale a suggestion. Stage **exactly `right` in `fix.field`** only after Use fix,
using the latest valid save token. If that field has a personal change or no longer matches, show it as out of date instead. For
inherited text, explicitly stage this inclusion's override; never change its root implicitly. Save remains explicit and can still
refuse a race. An `internal` fix remains a note and editor link; never automatically change a staff name.

Keep store-time rejection of unsolicited/nonmissing results, placeholders without draft text, Discard and save-time suggestion
cleanup. Keep the current provider boundary: the primary runner alone calls Cloud, retrying its recorded operation/body, storing
before release, and preserving progress, consent/cap/provider refusals, availability links and notices. No OpenAI key on the box.
Keep Cloud's design contract: usage counts only, menu/results deleted after collection or its 24-hour limit. Cloud was not verified
here. Its documented 20-language refusal stays separate from the editor's 200-language support (`docs/backlog.md`, Translate all
language-limit entry); do not hide it by clipping enabled languages or imply A682 repairs that provider limitation. Use the existing
fake Cloud for future local checks; D71 and A689-21 are not prerequisites for writing this change.

## Existing paths to change or review before implementation

| Exact existing path                                                                                                                                                                                                                                                                                                                                                                    | Required change or conditional review                                                                                                                                                                                                                           |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/catalogue/src/content-languages.ts`                                                                                                                                                                                                                                                                                                                                          | `PUT /management-api/content-languages`: remove completeness gate, retain regional/structural checks; separate optional-map validation.                                                                                                                         |
| `packages/catalogue/src/content-translation-report.ts`, `packages/catalogue/src/content-translation-report-types.ts`, `packages/catalogue/src/content-translation-targets.ts`, `packages/catalogue/src/content-translation-types.ts`                                                                                                                                                   | Align all gaps, bounded multilingual projections, direct-target eligibility, cell identity and expected tokens.                                                                                                                                                 |
| `packages/catalogue/src/content-translations.ts`, `packages/catalogue/src/content-translation-writes.ts`                                                                                                                                                                                                                                                                               | Atomic multilingual merge/removal, final dependency checks, retries and precise field refusals.                                                                                                                                                                 |
| `packages/catalogue/src/product-editor.ts`, `packages/catalogue/src/variants.ts`, `packages/catalogue/src/options.ts`, `packages/catalogue/src/extras.ts`, `packages/catalogue/src/sections.ts`, `packages/catalogue/src/include-folder.ts`; `apps/server/src/catalogue-api.ts`                                                                                                        | Retire default-text requirements on every catalogue write path, including the direct product route; preserve shape checks.                                                                                                                                      |
| `apps/server/src/content-translations-api.ts`; `apps/dashboard/src/api/client.ts`, `apps/dashboard/src/api/live-queries.ts`; `apps/server/src/catalogue-api.ts`                                                                                                                                                                                                                        | Existing `GET/PUT /management-api/content-translations/:language` and `GET /management-api/content-translation-gaps`: multilingual reads/save, dependencies and field errors; retain authorization/origin gates.                                                |
| `packages/catalogue/src/content-suggestion-store.ts`, `packages/catalogue/src/content-suggestion-collect.ts`, `packages/catalogue/src/content-suggestion-types.ts`; `apps/server/src/content-suggestions-api.ts`                                                                                                                                                                       | Existing `GET /management-api/content-suggestions?language=&after=`, `POST /management-api/content-suggestions/jobs`, `DELETE /management-api/content-suggestions/:id`: multilingual paging, fix baselines and cleanup; preserve job/discard/provider behavior. |
| `apps/dashboard/src/widgets/content-translations-model.ts`, `apps/dashboard/src/widgets/content-translations-dialog.ts`; `apps/dashboard/src/screens/content-languages-screen.ts`; `apps/dashboard/src/i18n/strings.ts`, `apps/dashboard/src/i18n/codes.ts`                                                                                                                            | Cell drafts, bounded display, filters, fresh Use fix, wrap notes and localized refusals. Keep `apps/dashboard/src/widgets/content-suggestions-bar.ts` states.                                                                                                   |
| `packages/catalogue/src/schema/units.ts`, `packages/catalogue/src/units.ts`, `packages/catalogue/src/product-types.ts`, `packages/catalogue/src/provisioning.ts`, `packages/catalogue/src/configuration-transfer.ts`; `apps/server/src/units-api.ts`; `apps/dashboard/src/widgets/unit-form.ts`, `apps/dashboard/src/api/client.ts`                                                    | Existing `GET/POST /management-api/units`, `GET/PATCH /management-api/units/:id`: conditional schema/input/read/seed/export changes after A/B; audit reset implications.                                                                                        |
| `packages/catalogue/src/operations.ts`, `packages/catalogue/src/extra-projection.ts`, `packages/catalogue/src/menu-types.ts`; `packages/module/src/module.ts`                                                                                                                                                                                                                          | Conditional unit projection changes, including extras and implicit Each; shared reserved contract needs coordination.                                                                                                                                           |
| `apps/dashboard/src/screens/units-screen.ts`; `apps/dashboard/src/widgets/product-editor.ts`, `apps/dashboard/src/widgets/product-details.ts`, `apps/dashboard/src/widgets/product-list.ts`, `apps/dashboard/src/widgets/extra-list-form.ts`, `apps/dashboard/src/widgets/device-home-preview.ts`; `apps/till/src/widgets/product-name.ts`, `apps/till/src/widgets/modifier-picker.ts` | Conditional unit fallback in lists, sorting, pickers and labels. Keep product names audience-specific.                                                                                                                                                          |

## Snapshot production is separate from snapshot reading

Future production needs a distinct fallback review: `product-presentation.ts` → `customerPresentationText`, `offered-modifiers.ts`,
`default-language-text.ts`, `pricing.ts`; `apps/server/src/working-order.ts` → `priceOrderLines`, `modifier-selection.ts` →
`answerFreezers`; `apps/till/src/state/working-order.ts` → `toPriceable`, `held-options.ts` → `optionSnapshotOf`; and
`packages/venue-service/src/operations.ts:1359` (working-line unit context). Resolve fallback before new snapshots lose access to staff
values. Keep the existing receipt-language key policy; do not introduce per-receipt-language product names as an incidental change.

Reading existing snapshots stays unchanged: shared `resolveSnapshotText`, catalogue `joinCustomerPresentationText` /
`customerOptionSnapshotLabels`, server `receipt-lines.ts`, `receipt-figures.ts`, `receipt-document.ts`, `invoice-document.ts`,
`transaction-receipt.ts`, `kitchen-print.ts`, and till `screens/till-ticket-view.ts`. Never consult today's catalogue to repair old
names. `packages/core/src/sale-line-rows.ts` copies supplied presentation values; do not change that fiscal writer. Published menu
document/hash rows and recorded orders, sales, reprints and queued documents stay immutable; working menu changes require explicit
publication for future use.

Unit additions also reach new publication through `menu-document.ts` → `freezeOffer` and its change comparison. Do not rewrite old
documents or their hashes. **Owner review is required if completing this scope needs any H2-protected fiscal writer, alta builder,
hash/numbering path or fiscal test.** This design grants no such permission. Before implementation, resolve the active reservations
in `apps/server/src/till-api.ts`, `working-order.ts`, `receipt-lines.ts`, `packages/catalogue/src/menu-document.ts` and
`packages/module/src/module.ts`; none is edited here. If A needs a migration, coordinate with A760's still-pending migration
drain/squash before generating; do not edit shipped migrations, guards or root instructions. No speculative backfill is proposed.

Future acceptance: the unit example; nine kinds/blank defaults; clear/disabled text; 200 languages with bounded mounted fields;
100-edit/byte limits; atomic rollback/retry and root/include peers; archived direct targets; stale recovery; late suggestions versus
personal edits; fresh/stale fixes on complete rows; unchanged publication/fiscal/snapshot rows and reprints. Use distinct audience
fixture names; look in EN/ES, both themes, phone and desktop. In the future PR update `products.md`, `design-system.md`, operator
wording and the backlog, retaining historical Translate all text with a dated pointer.

## 2026-10-17 reconciliation: Spanish and approved unit option A

Spanish being required everywhere leaves one visible conflict to settle: keeping a language enabled
does not establish whether you must enter its customer text before saving. The decisions below
replace the historical pending unit question; they do not approve the full design.

At 16:15, asked about a Spanish venue with an unknown province, you answered, “I think Spanish is
required everywhere”. The watcher reads this as Spanish names required regardless of province,
with Catalonia's extra rule unchanged. That reading needs the distinction below before it can
become a requirement to refuse saves.

At 16:25, you approved **unit option A**: add a required language-independent staff name and
abbreviation; every translated name and abbreviation is optional. You can clear both translated
maps completely and retain the staff pair for displays and future snapshots. Option B remains in
the original proposal only as a historical alternative. The A/B choice is closed.

For example, give a unit staff name `Kilogramo` and staff abbreviation `kg`, then clear both
translated maps to `{}`. Under approved A, saving that unit is allowed. With no translated values,
displays retain `Kilogramo` / `kg`, and new receipt snapshots can retain staff `kg` through the
proposed fallback. The report still flags its missing translated name and abbreviation in each
enabled language, counting the unit once per language. Assess the pre-live migration/reset
implications later; this addendum makes no verdict about them.

### Enabled languages and entered text are separate requirements

Reading [products.md, The three names](../../developers/products.md#the-three-names): staff and
kitchen product/variant names are plain text, not language maps. Customer-facing names are language
maps. A Spanish-looking staff name does not fill the Spanish customer field, and no Spanish kitchen
map exists to require. Keep those audiences separate.

Reading [The translation gap report](../../developers/products.md#the-translation-gap-report): a
content-language save must retain the area's required-enabled languages, but “nothing makes that
language's text complete”. Reading [Content languages per region](../../developers/products.md#content-languages-per-region):
the wording describes languages Waitron keeps enabled and distinguishes existing venues' effective
rules from their stored language list. These are documentation readings, not a new runtime experiment
or legal finding. The 16:15 answer extends the Spanish requirement to an unknown province; it does
not by itself settle the separate customer-text save rule.

Take a Spanish venue whose province is unknown, with Spanish and English enabled and English as
default. You enter staff `Patatas`, kitchen `PAPAS`, customer English `Potatoes`, and leave customer
Spanish blank. These are proposed outcomes, not a runtime demonstration:

| Interpretation                               | What happens when you save this product                                                                                                                                               |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Keep Spanish enabled and report missing text | Save succeeds. The Spanish customer-name gap remains listed. Staff still see `Patatas`, the kitchen sees `PAPAS`, and English customer presentation uses `Potatoes`.                  |
| Require entered Spanish customer text        | Save is refused until you explicitly enter Spanish customer text, even though Spanish is enabled and the staff name is `Patatas`. This adds validation beyond the original A682 rule. |

**One owner question: for this `Patatas` / `PAPAS` / English `Potatoes` example with Spanish blank,
does “Spanish is required everywhere” mean refusing the product save until you enter Spanish
customer text, or keeping Spanish enabled and allowing the save while reporting the gap?**

Author's recommendation, pending your answer: preserve A682's optional customer-text rule and
require Spanish to stay enabled everywhere in Spain, including an unknown province. Report every
missing enabled-language value, including Spanish and the default. This fits your later unit A
answer, which explicitly allows clearing every translation. It is a recommendation, not approval.
Do not copy staff names into translation maps or treat generated text as a compliance fix.

If you choose stronger entered-text validation, the design must settle its exact domains and fields:
product and variant customer names; options-list and options-label customer names; extras-list
customer names; menu/root, section and included-menu override names; and whether unit translated
names or abbreviations are covered despite approved A. It must also settle whether the rule refuses
working-editor saves, publication, or both, including edits to existing incomplete items. Those are
consequences to resolve in the design, not an approved policy or additional owner questions here.

Under either interpretation, keep all other enabled languages reachable within the existing
200-language bound. Switching the default stays free of completeness checks, and Catalonia keeps
its additional Catalan-enabled rule. Existing venues' missing text remains listed; missing text
must not block sales or boot, or trigger silent backfill. Never rewrite recorded snapshots, old
fiscal data, published documents or hashes. Any new fallback applies to future snapshots only.

Reuse the editor, Translate all, Use fix and deliberate-save design above unchanged. Full design
approval, implementation and the detailed plan wait for this one visible conflict. No H2 permission
is requested or granted here.
