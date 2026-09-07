# Generic code is English; Spanish only in Spain-specific modules

**Status:** design, revised after re-measuring against post-`fiscal-none` (#262) `main` (2026-09-07)
**Owner principle (2026-09-07):** *Spanish terms may be used only in Spain-specific modules
(Veri\*Factu, the Spanish labour module, the Spanish VAT-return module). If it is in core/generic
code, it must be in English — identifiers, string literals, AND comments.*
**Owner decision on comments (2026-09-07):** *scan comments too, but leave QUOTATIONS intact* —
verbatim regulatory quotes and cited proper-noun identifiers/terms are exempt; bare Spanish prose is
reworded to English.

## 1. Why

PR #258 renamed a generic guard onto the Spanish word `obligado` (`assertNoForeignObligado`,
`obligadoTenantId`, error `provisioning.foreign_obligado`) and it reached `origin/main` uncaught by
lint or CI. #260 reverted it. The english-only guard did not catch it for two independent reasons,
both of which this design closes:

1. **`@waitron/provisioning` is not scanned at all.** It is absent from `GENERIC_PACKAGES`
   (`packages/db/src/english-only.ts`). A guard-free zone in generic code is exactly where `obligado`
   slipped in. (`fiscal-modules.ts` parked the territory→module registry `{ filing:"verifactu",
   tax:"iva" }` in provisioning precisely because provisioning was unscanned; §4 makes it pass honestly.)
2. **The guard strips comments before scanning.** `obligado` also appeared in provisioning/server
   comments; those are never scanned anywhere.

## 1a. What the re-measurement changed (READ THIS FIRST)

The first draft of this design estimated "~428 tokens" and treated the work as a large
identifier/string sweep, sequenced to wait for Track C to relocate fiscal code out of `core`. Both
premises were wrong. Measured 2026-09-07 against post-#262 `main`, with comments included, over the
full proposed scanned set (snapshot for planning; a count goes stale — CLAUDE.md §7):

- **The real identifier/string leak in generic PRODUCTION code is ~1 line** — `fiscal-modules.ts`'s
  `{ filing:"verifactu", tax:"iva" }` registry, whose `iva` §4 renames to `vat` (behaviourally inert).
  Every other generic package's production code is already English at the identifier/string level.
- **`provisioning` tests (~72) and `ui` tests (~8)** hold the other code-level hits. Provisioning's
  e2e/pg probes provision a REAL Spanish Veri\*Factu venue, so their Spanish is DOMAIN DATA: the
  unrenameable fiscal tables in SQL (`registros_facturacion`, `registro_sif`, `cadenas`,
  `contadores_instalacion`) and realistic es-ES venue data — localized default names the code
  resolves (`Mostrador` from `@waitron/layouts`' `nameByLocale`, asserted by `venue-plan.test.ts`), a
  `"Caja 1"` till name, a Spanish operation description. The one genuinely avoidable token, `tax:"iva"`,
  is the §4 rename. `ui`'s hits are DIFFERENT — gratuitous Spanish fixture strings (`"Anular venta"`,
  `"Precio"`) in tests that are NOT provisioning a Spanish venue, so they were reworded, no exemption.
- **The body of the work is ~400 COMMENT hits** (after the quotation exemption, §3). They are not
  sloppiness: `core` reaches fiscal ONLY through the `@waitron/fiscal` seat (`FiscalBackend`;
  `fiscal-none` implements the same `recordCorrection`), so the code is genuinely regime-neutral —
  but the comments describe those regime-neutral operations in **Veri\*Factu's Spanish dialect**,
  because Veri\*Factu was the only regime that existed when they were written. Englishing them
  finishes the abstraction fiscal-none exposed; it is not cosmetic. Concentrated in `core`, `db`,
  `workforce`, with `purchasing`/`catalogue`/`fiscal` small.

There is therefore **nothing to wait for** — the code is already behind the seat. The old §6
"wait for Track C" gate is gone.

## 2. Principle → package classification

Every `packages/*` and `apps/*` is exactly one of:

- **Spain-specific module — Spanish allowed, NOT scanned.** Its domain vocabulary (fiscal/labour/tax)
  is inherent and has no English equivalent worth losing.
  - `fiscal-verifactu` (owns `FISCAL_VOCABULARY`; already excluded as a vocabulary owner)
  - `workforce-es` (owns `WORKFORCE_ES_VOCABULARY`; already excluded)
  - `verifactu` (the AEAT wire-protocol library; already unlisted)
  - **`reporting`** (the modelo-303 / DR303 Spanish VAT return) — its comments ARE the official AEAT
    form layout, verbatim (`total cuota devengada [27]`, `Sujeto pasivo acogido al régimen especial
    del criterio de Caja`, casilla numbers, `ejercicio`, `periodo`). Confirmed Spanish-specific by
    re-measurement — REMOVE from `GENERIC_PACKAGES` (owner decision 2026-09-07).
- **Generic — MUST be English (identifiers, strings, comments); scanned.**
  - `migrations` — now GENERIC/English: it is the migration RUNNER (`apply.ts`, `manifest.ts`,
    `schema-version.ts`); the Veri\*Factu DDL already lives in `packages/fiscal-verifactu/src/schema`.
    Measured clean but for one SQL-injection *test fixture* string. ADD to `GENERIC_PACKAGES`.
  - Newly added to the scan: **`provisioning`**, **`tunnel`**, **`payments-stripe`**, **`ui`**
    (`tunnel`/`payments-stripe` measured already clean), and **`fiscal-none`** — the no-op regime is
    generic English (declares no vocabulary), so it belongs in the scanned set; it was unscanned by
    omission (the same silent gap this design closes), and measured clean. Contrast the Spanish
    regime `verifactu`, which owns `FISCAL_VOCABULARY` and is never scanned.
  - Already scanned: `core`, `db`, `shared`, `payments`, `scheduler`, `credentials`, `workforce`,
    `identity`, `catalogue`, `sync`, `membership`, `module`, `layouts`, `recipes`, `purchasing`,
    `printing`, `diagnostics`, `sync-enrolment`, `composition`.
- **Composition root — documented exemption.**
  - `apps/*` (composition root; already documented out of scope in `english-only.ts`)

The `configuration` test asserts (as today) that no vocabulary owner is in `GENERIC_PACKAGES`; it
also pins the explicit Spain-specific NON-owner exclusions (`verifactu`, `reporting`) so a future
edit cannot silently re-add one, and so "unscanned" is never again a silent gap (the
`fiscal-modules.ts` incident). The pinned `GENERIC_PACKAGES` list in that test is updated.

## 3. Guard change (`packages/db/src/english-only.ts` + `scripts/english-only.test.ts`)

**Scan comments, exempt quotations.** Today `findSpanish` blanks block comments and drops `//` line
comments before tokenising, so comments are never scanned. The new behaviour scans comment text too,
against the full forbidden set (base list + module vocabulary), with two exempt span kinds — the
owner's "leave quotations intact":

1. **`«…»` guillemet spans** — verbatim regulatory quotes (the source's own words; CLAUDE.md §1).
2. **`` `…` `` backtick spans — INSIDE COMMENTS ONLY** — a backticked term is a citation of a
   specific identifier, wire-protocol field or owned term (`` `FacturasSustituidas` ``,
   `` `convenio_config` ``, `` `ausencia` ``, `` `registro de alta` `` as a named term of art).

**Critical constraint — backtick exemption is comment-scoped, never global.** In CODE a backtick
opens a TEMPLATE LITERAL, and `` sql`select … from registros_facturacion` `` is exactly the
Spanish-table-name-in-a-string case the guard exists to catch (its load-bearing test). Blanking
backticks in code would reopen that hole. So the guard must be comment-aware: blank `` `…` `` only
within comment regions; scan code (identifiers, string AND template literals) in full as today.
Guillemets `«…»` may be blanked globally (they occur only in regulatory quotes, always in comments).

Mechanics (keeping the existing text-heuristic, whole-source-before-line-split shape so multi-line
`«…»`/`` `…` `` spans are handled — a regulatory quote wraps across lines, e.g.
`core/record-correction.ts`):

- Replace `blankBlockComments` with a pass that PRESERVES each `/* … */` region but blanks `«…»` and
  `` `…` `` spans within it (spaces, preserving newlines/line numbers).
- Replace `dropLineComment` with a per-line split at `//` (keeping the `https://` guard): the code
  part is scanned unchanged; the comment part has `«…»` and `` `…` `` blanked, then is scanned.
- `SELF` still excludes the two files that define forbidden-word lists in plain text.

Discipline (as §2's "no exception list that grows"): a backticked term is a citation, not a dodge.
Backtick a genuine term of art / proper noun / cited identifier and English the surrounding prose;
do not backtick `venta` to smuggle it. Visible in review.

**Provisioning is scanned production-only, as a documented INTERIM — the ONLY test exemption.** Its
e2e/pg tests provision a real Veri\*Factu venue and so name the Spanish fiscal tables in SQL, which
cannot be renamed. Until the provisioning tests are made regime-agnostic against `fiscal-none` (§6
step 5), `sourceFilesIn("provisioning")` excludes `*.test.ts`, documented with its removal condition.
`ui` is different: its ~8 test hits are AVOIDABLE fixture strings, so `ui` is scanned in FULL and its
fixtures are reworded to English — no exemption. Every other generic package keeps the existing
"tests are scanned too" rule.

## 4. Make `fiscal-modules.ts` pass the scan (rename `iva`→`vat`; NO relocation)

The first draft proposed relocating the territory→module registry to `@waitron/composition`. That is
**wrong**: `scripts/module-seams.test.ts` forbids `packages/provisioning/src/*` (except `bin.ts`)
from importing `@waitron/composition`, so provisioning could not import the registry back. Relocation
is also **unnecessary**. Checking both guards against the registry left in provisioning:

- **english-only** (now scans provisioning production): `"verifactu"` is a proper noun, absent from
  the forbidden set; `"none"` is English. The ONLY Spanish token is `tax:"iva"` (`iva` ∈
  `FISCAL_VOCABULARY`).
- **no-regime-vocabulary** scans ONLY `packages/fiscal`, so it never reaches provisioning — `verifactu`
  as a string literal there is fine.

So the fix is to **rename the tax-module slot value `iva`→`vat`** and leave the registry in
provisioning. `vat` is the tax MODEL (owner 2026-09-07: the tax model — VAT / GST — is generic and
English and belongs in core with helpers; the fiscal module supplies the rates and the localised
display label, e.g. `«IVA»` in verifactu). The value is behaviourally INERT — stamped into
`nodes.tax_module` and copied verbatim during mirror adoption (`apps/server/src/adopt.ts`,
`reserved-identity.ts`), but never BRANCHED on: no calculation depends on which value it holds (so
"nothing reads it" would be wrong — adoption reads and copies it; nothing acts on the value). The
rename is safe pre-production (CLAUDE.md §5: no bwc, drop-and-recreate). Blast radius: the registry
(1 prod line) + ~8 test files
asserting the stored value; `GB-vat`'s `tax:"none"` stays (no tax module wired for GB yet). Update
`fiscal-modules.ts`'s header: the "parked here to dodge the guards" justification is gone — it now
passes the scan honestly.

**Follow-on recorded in the backlog (NOT built here):** the tax-MODEL system — VAT/GST calculation
helpers in core, inclusive-vs-exclusive pricing, receipt tax-naming, the fiscal module supplying the
rates and the per-jurisdiction label ("IVA" in ES, "VAT" in the UK — a locale property, not a model
property). Today `tax` is an inert label; that is the future home for it.

## 5. English-ify the generic comment prose

Reword every Spanish token the (comment-inclusive, quotation-exempt) scan flags to English — in
identifiers, string literals and comments. The body is the ~400 comment residue (§1a), plus ~9 test
fixtures (`ui`, and avoidable provisioning fixtures) and the §4 `iva`→`vat` rename.

- **Preserve precision.** The exact AEAT field/law terms stay where they are genuine citations —
  backticked (`` `FacturasRectificadas` ``, `` `registro de alta` ``) or quoted (`«en todo caso»`,
  `RD 1619/2012`). A document/article number is not a translatable word. In generic PROSE use the
  English concept.
- **Safety-critical (§1/§5 of CLAUDE.md):** `core/record-sale.ts`, `record-correction.ts`,
  `record-substitution.ts`, `record-void.ts` comments carry fiscal-legal rationale. A reword must
  preserve the invariant and the *why*; individual review, never a bulk sed.
- **Chosen renderings** (to keep the sweep consistent): `desglose`→`breakdown`,
  `huella`→`fiscal fingerprint` (owner 2026-09-07, NOT "hash"), `rectificativa`→`corrective invoice`,
  `anulacion`→`annulment`, `alta` (as `registro de alta`)→`the fiscal record` / keep as backticked
  term of art where the AEAT operation is precisely meant, `convenio`→`collective agreement`,
  `jornada`→`working day`/`working time`, `turno`→`shift`, `centro de trabajo`→`workplace`,
  `cuota`→`amount`/`share` (per context; IVA context → `VAT amount`), `envio(s)`→`submission(s)`,
  `registro(s)`→`record(s)` as a generic word (the TABLE name `registros_facturacion` stays, cited
  backticked, in provisioning tests only). A full rendering table lives in the plan.

## 6. Sequencing

`fiscal-none` has LANDED (#262), and `core` already reaches fiscal through the seat, so the sweep is
unblocked NOW — there is no code-relocation to wait on. Order:

1. Guard change (§3): scan comments with the quotation exemption, comment-scoped backtick blanking,
   whole-source span handling. Prove by deletion + controls (§7). This turns the suite RED.
2. Package lists (§2): add `provisioning`(prod-only), `tunnel`, `payments-stripe`, `ui`, `migrations`;
   remove `reporting`. Update the pinned `configuration` list.
3. Rename the tax-module slot value `iva`→`vat` in `fiscal-modules.ts` (§4); update the ~7 test
   assertions of `nodes.tax_module`. No relocation (module-seams forbids it and it is unneeded).
4. English-ify (§5): the comment residue + `ui`/provisioning fixtures. Per package, `core`'s
   fiscal-legal files individually reviewed. Suite goes GREEN — that IS the proof.
5. **After this design ships (own follow-on): drop the provisioning production-only interim (§3.3).**
   `fiscal-none` (now landed) is the clean way: run provisioning's tests against `fiscal-none` so
   they never touch the Spanish fiscal schema, and move the Veri\*Factu-specific provisioning tests
   into `fiscal-verifactu`'s own suite. OUT OF SCOPE for this design's first implementation.

## 7. Verification

- The guard's own suite (`scripts/english-only.test.ts`, root project) goes green on the reworded
  tree with comment-scanning on — that IS the proof. Each package's own `typecheck`/tests stay green
  through the identifier renames and the `fiscal-modules.ts` move.
- Prove the guard by deletion / controls:
  - a bare Spanish comment in a generic package FAILS;
  - the same word inside `«…»` or inside `` `…` `` in a comment PASSES;
  - a Spanish word inside a `` sql`…` `` TEMPLATE LITERAL in code still FAILS (the backtick
    exemption must not reach code — the load-bearing table-name case);
  - a Spanish comment in a Spain-specific module (`fiscal-verifactu`, `reporting`) does NOT fail
    (out of scope by classification).
- The no-regime-vocabulary guard stays green after the `fiscal-modules.ts` move.

## 8. Out of scope

- Making provisioning's TESTS regime-agnostic against `fiscal-none` and moving the Veri\*Factu-specific
  provisioning tests into `fiscal-verifactu` (§6 step 5) — drops the production-only interim; its own
  follow-on.
- Any change to what the fiscal schema TABLES are named — they remain the AEAT Spanish names, in the
  fiscal module.
- `apps/*` identifier scanning — still out of scope by the recorded composition-root decision.
