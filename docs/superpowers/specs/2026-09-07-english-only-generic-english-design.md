# Generic code is English; Spanish only in Spain-specific modules

**Status:** design, awaiting owner review (2026-09-07)
**Owner principle (2026-09-07):** *Spanish terms may be used only in Spain-specific modules
(Veri\*Factu, the Spanish labour module, the Spanish VAT-return module). If it is in core/generic
code, it must be in English — identifiers, string literals, AND comments.*

## 1. Why

PR #258 renamed a generic guard onto the Spanish word `obligado` (`assertNoForeignObligado`,
`obligadoTenantId`, error `provisioning.foreign_obligado`) and it reached `origin/main` uncaught by
lint or CI. #260 reverted it. The english-only guard did not catch it for two independent reasons,
both of which this design closes:

1. **`@waitron/provisioning` is not scanned at all.** It is absent from `GENERIC_PACKAGES`
   (`packages/db/src/english-only.ts`). `provisioning/src/fiscal-modules.ts` documents this as
   deliberate — it parks the territory→module registry `{ filing: "verifactu", tax: "iva" }` in
   provisioning precisely because provisioning is a guard-free zone (naming `verifactu`/`iva`
   elsewhere trips either the no-regime-vocabulary guard or english-only). A guard-free zone in
   generic code is exactly where `obligado` slipped in.
2. **The guard strips comments before scanning.** `obligado` also appeared in provisioning/server
   comments; those are never scanned anywhere.

## 2. Principle → package classification

Every `packages/*` and `apps/*` is exactly one of:

- **Spain-specific module — Spanish allowed, NOT scanned.** Its domain vocabulary (fiscal/labour/tax)
  is inherent and has no English equivalent worth losing.
  - `fiscal-verifactu` (owns `FISCAL_VOCABULARY`; already excluded as a vocabulary owner)
  - `workforce-es` (owns `WORKFORCE_ES_VOCABULARY`; already excluded)
  - `verifactu` (the AEAT wire-protocol library — 7767 Spanish identifiers; already unlisted)
  - **`reporting`** (the modelo-303 / DR303 Spanish VAT return — `iva`/`cuota`/`periodo`/`ejercicio`
    are the form; owner decision 2026-09-07) — REMOVE from `GENERIC_PACKAGES`
  - ~~`migrations`~~ — **NOT Spanish-specific. It is GENERIC (English).** Owner (2026-09-07): the
    Veri\*Factu table migrations are moving OUT of core into the verifactu module in **Track C (with
    `fiscal-none`, almost landed)**. Its current fiscal Spanish (`registros_facturacion`, `huella`,
    `cadenas`) LEAVES with that code, so `migrations` ends up English on its own. Add it to the scanned
    generic set once Track C has moved the fiscal DDL out (its 2 current hits resolve then, not by
    hand-rewording DDL that is about to relocate).
- **Composition — names every module by identity; documented exemption.**
  - `apps/*` (composition root; already documented out of scope in `english-only.ts`)
  - the `fiscal-modules.ts` territory→module registry — **relocated to `@waitron/composition`**
    (§4), the one place designed to name every module.
- **Generic — MUST be English (identifiers, strings, comments); scanned.** Everything else, now
  explicitly including `provisioning` (production), `tunnel`, `payments-stripe`, and `ui`, alongside
  the packages already scanned (`core`, `db`, `shared`, `payments`, `scheduler`, `credentials`,
  `workforce`, `identity`, `catalogue`, `sync`, `membership`, `module`, `layouts`, `recipes`,
  `purchasing`, `printing`, `diagnostics`, `sync-enrolment`, `composition`).

The guard test asserts, as it does today, that no vocabulary owner is in `GENERIC_PACKAGES`; it gains
an explicit, documented list of the Spain-specific NON-owner exclusions (`verifactu`, `reporting`,
`migrations`) so a future edit cannot silently re-add one, and so "unscanned" is never again a
silent gap (the `fiscal-modules.ts` incident).

## 3. Guard change (`packages/db/src/english-only.ts` + `scripts/english-only.test.ts`)

1. **Scan comments.** `findSpanish` currently blanks block comments and drops `//` line comments
   before tokenising. Drop that stripping so identifiers, string literals AND comments are all
   scanned against the full forbidden set (base list + module vocabulary). `SELF` still excludes the
   two files that define forbidden-word lists in plain text.
2. **`GENERIC_PACKAGES`:** add `provisioning`, `tunnel`, `payments-stripe`, `ui`; remove `reporting`.
   Update the `configuration` test's pinned list.
3. **Provisioning is scanned production-only, as a documented INTERIM — the ONLY test exemption.**
   Its e2e/pg tests provision a real Veri\*Factu venue and so name the Spanish fiscal tables
   (`registros_facturacion`, `cadenas`) which cannot be renamed (they are the real tables). Until
   `fiscal-none` lands (§6), `sourceFilesIn("provisioning")` excludes `*.test.ts`, documented with
   its removal condition. `ui` is different: its ~8 test hits are the AVOIDABLE base-POS words
   (`venta`, `precio`) in fixture data, so `ui` is scanned in FULL and its fixtures are reworded to
   English (`sale`, `price`) — no exemption. Every other generic package keeps the existing "tests
   are scanned too" rule.

## 4. Relocate `fiscal-modules.ts`

Move the territory→module registry (`REGISTRY`, `resolveFiscalModules`, `FiscalModules`,
`FISCAL_TERRITORIES`) from `packages/provisioning/src/fiscal-modules.ts` to `@waitron/composition`
(which already names every module and is the composition root for the module list). Provisioning
imports it from there. This removes the guard-free-zone justification and lets provisioning
production be scanned with nothing exempted. Verify the no-regime-vocabulary guard
(`@waitron/fiscal`) is satisfied at the new home (composition legitimately names regimes).

## 5. English-ify the generic packages

Reword every Spanish token the (comment-inclusive) scan flags in the generic set to English, in
identifiers, string literals and comments. After reclassifying `reporting` (−371), the remaining
sweep is ~428, concentrated in `core` (127), `workforce` (141), `db` (95), with the rest small.

- **Preserve precision:** the exact AEAT field names (`desglose`, `huella`, `cuota`) stay inside the
  Spain-specific modules; in generic code use the English concept (`breakdown`, `fiscal hash`,
  `amount`). Where a generic comment cites Spanish law (`RD 1619/2012`, `«en todo caso»` in
  `core/record-sale.ts`), keep the legal citation (a document number is not a translatable word) and
  render surrounding prose in English.
- **Safety-critical (§1/§5):** `core/record-sale.ts` comments explain fiscal-legal rationale. A
  reword must preserve the invariant and the *why*; it is not a mechanical find/replace. These files
  get individual review, not a bulk sed.
- **Chosen renderings** (to keep the sweep consistent): `desglose`→`breakdown`,
  `huella`→`fiscal fingerprint` (owner 2026-09-07, NOT "hash"), `rectificativa`→`corrective invoice`,
  `convenio`→`collective agreement`,
  `jornada`→`working day`, `turno`→`shift`, `cuota`→`amount`/`share` (per context),
  `envio(s)`→`submission(s)`, `registro(s)`→`record(s)` (as a generic word; the TABLE name
  `registros_facturacion` is fiscal-module-only). A rendering table lives in the plan.

## 6. Sequencing & the Track C / `fiscal-none` dependency

**Do not race ahead of Track C.** Owner (2026-09-07): Track C (with `fiscal-none`, almost landed)
moves the Veri\*Factu table migrations — and the fiscal write path — OUT of core into the verifactu
module. A large share of the ~428 remaining violations is exactly that fiscal code (`huella`,
`registro`, `desglose`, `rectificativa` in `core`/`db`/`migrations`): it should travel WITH the code
as it relocates into the (Spanish-allowed) verifactu module, not be hand-reworded in place first.
**So this design's rework step runs AFTER Track C has moved the fiscal code out**, and reworks only
what genuinely stays in generic packages by then. Re-run the diagnostic against post-Track-C `main`
to get the real remaining set before planning the sweep — the pre-Track-C 428 is an overcount.


`fiscal-none` (a no-fiscal regime module, close to landing) is the clean way to make provisioning's
TESTS regime-agnostic: run them against `fiscal-none` so they never touch the Spanish fiscal schema,
and move the Veri\*Factu-specific provisioning tests into `fiscal-verifactu`'s own suite. That is the
final step and removes the §3.3 production-only interim. It is OUT OF SCOPE for this design's first
implementation (it depends on `fiscal-none`); this design ships everything that does not.

Order: (1) NOW, independent of Track C: add `tunnel`+`payments-stripe` (already clean) to the scan;
(2) relocate `fiscal-modules.ts` → `@waitron/composition`, then scan `provisioning` production;
(3) AFTER Track C moves the fiscal code out: re-measure, then English-ify what genuinely REMAINS in
the generic packages; (4) flip comment-scanning on + update the package lists — reclassify `reporting`
OUT (Spanish-specific), add `migrations` IN (now English, its DDL having moved); (5) after `fiscal-none`:
provisioning tests → `fiscal-none`, drop the production-only interim. Steps 1–2 can land before Track C;
3–5 follow it.

## 7. Verification

- The guard's own suite (`scripts/english-only.test.ts`, root project) goes green on the reworded
  tree with comment-scanning on — that IS the proof. Each package's own `typecheck`/tests stay green
  through the identifier renames.
- Prove the guard by deletion: re-introduce a Spanish identifier AND a Spanish comment in a generic
  package and confirm each fails; confirm a Spanish comment in a Spain-specific module (e.g.
  `fiscal-verifactu`) does NOT.
- The no-regime-vocabulary guard stays green after the `fiscal-modules.ts` move.

## 8. Out of scope

- Building `fiscal-none` (separate Track A/C module work; this design's §6 step 5 waits on it).
- Any change to what the fiscal schema TABLES are named — they remain the AEAT Spanish names, in the
  fiscal module.
