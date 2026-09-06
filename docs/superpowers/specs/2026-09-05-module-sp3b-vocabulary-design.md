# SP-3b — Module-owned vocabulary (the fiscal module's `vocabulary` seat)

**Date:** 2026-09-05
**Status:** design. **Owner-reviewed:** the design below was presented and approved 2026-09-05 (Track C
session). Two override points were offered and not taken: the generic package list stays explicit, and
a module's package is derived from `migrations.from` rather than declared on the seat.

**Implements:** [module-system-architecture](2026-09-04-module-system-architecture-design.md) §3
("vocabulary + error codes — the regime terms it legitimately uses, generalising the english-only
`EXEMPT_PACKAGES` list to 'a module declares its own vocabulary'"), §4 (the vocabulary registry the
guard reads) and §9 ("English-only guard preserved, not exempted-around"). The second of SP-3's four
slices ([sp-3a](2026-09-05-module-sp3a-fiscal-record-lane-design.md) lists them); independent of 3a,
3c and 3d.

**Implementation notes (2026-09-05, the simplify pass before the PR; supersede §4–§6 where they
differ):** the descriptor helpers live in `@waitron/module` — `packageDirOf` on the contract
(`module.ts`) and `vocabularyOwners`/`forbiddenVocabulary` in `vocabulary.ts` — not in
`english-only.ts`: there is no dependency cycle in that direction, the seat's owner package owns its
semantics and typechecks them, and `scripts/module-graph-honesty.test.ts` reads the same derivation
instead of its own regex. The package-local tokeniser copies (§6) and their byte-identity pin were
dropped: the root suite runs on every non-docs push and is the positive control, with the guard's
own comment stripping. The `invoice_series` test keeps only the exact column pin (the word filters
were dead behind it), and `modules.test.ts` pins the two seats by reference only. The package-local
file that remains in `packages/fiscal-verifactu` proves only the reverse-direction scoping of
`packages/fiscal`'s guard and is named `no-regime-scope.test.ts`.

---

## 1. What this is, and its scope

Today `packages/db/src/english-only.ts` centrally knows every domain's Spanish words (`SPANISH_WORDS`,
grouped by domain in comments) and which packages may use them (`EXEMPT_PACKAGES`). A new fiscal
module, or a third-party module, would have to edit that core file to declare its vocabulary — the
generic-layer-knows-every-domain coupling the module system exists to remove.

After this slice a module **declares its own vocabulary on its descriptor**, the guard file keeps only
a base list of generic Spanish no module owns, and the root suite assembles the forbidden set from the
descriptors. The generic packages stay exactly as guarded as they are today: the assembled set equals
the current list, so the scan's verdict on every generic package is unchanged by construction (§7).

**In scope:** the seat's semantics and token contract; `FISCAL_VOCABULARY` and
`WORKFORCE_ES_VOCABULARY` in their owning packages, wired onto the descriptors; the guard refactor
(base list, required word-set parameter, derived owners); the root suite rewrite; the two consumer
tests that depended on the central list; retiring every comment receipt the move falsifies; CLAUDE.md
§3.

**Out of scope, named:** widening `GENERIC_PACKAGES` (§8); `apps/*` (out of scope by the recorded
decision in `english-only.ts`); `packages/fiscal`'s `no-regime-vocabulary.test.ts` (a different guard —
it forbids *English* regime terms in the regime-neutral contract package); error-code registries
(already package-owned via declaration merging and guarded once in `scripts/errors-reachable.test.ts`);
any runtime consumer (nothing at boot reads the seat, and this slice adds no such reader).

## 2. The seat

`WaitronModule.vocabulary?: readonly string[]` keeps its SP-1a type; this slice fixes its meaning:

> The domain terms this module **owns**: legitimate inside the module's own package, forbidden in
> every generic package. Tokens, not words: lowercase ASCII `a–z` only, accents already removed (the
> tokeniser NFD-strips, so `anulación` and `anulacion` are one token), singular and plural listed
> separately, nothing stemmed. No runtime consumer — the root english-only suite is the only reader.

**Who owns which package.** A module that declares vocabulary owns the package its `migrations.from`
points at (`../<pkg>/drizzle` → `packages/<pkg>`), the same derivation
`scripts/module-graph-honesty.test.ts` already uses to map descriptors to `drizzle/` directories. This
is why no `packages` field is added to the seat. Derived for today's descriptors: `fiscal` →
`fiscal-verifactu`, `workforce-es` → `workforce-es`. A vocabulary-declaring descriptor whose `from`
does not match that shape is a descriptor bug and is refused loudly.

**One declaring home per word.** The base list (§4) and the module declarations are disjoint:
`base ∩ ⋃ module.vocabulary = ∅`, asserted by the root suite. Two *modules* may declare the same word
(a second fiscal regime will also say `huella`); the base list may not re-absorb a module's word. This
is what stops the central list from quietly growing back.

## 3. What moves where

Every section of today's `SPANISH_WORDS` moves **verbatim** to exactly one home:

| section (today's comment heading)                       | destination                                                                            |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| chain and record vocabulary                             | `FISCAL_VOCABULARY`                                                                    |
| invoice vocabulary                                      | `FISCAL_VOCABULARY`                                                                    |
| parties and identity                                    | `FISCAL_VOCABULARY`                                                                    |
| submission vocabulary                                   | `FISCAL_VOCABULARY`                                                                    |
| time (`fecha`, `fechas`, `hora`, `huso`)                | `FISCAL_VOCABULARY` (AEAT's `FechaHoraHusoGenRegistro`)                                |
| deployment-environment: `entorno`, `entornos`           | `FISCAL_VOCABULARY` (`registros_facturacion.entorno` is a fiscal column)               |
| deployment-environment: `descripcion`, `descripciones`  | **base list** (generic Spanish, no owner)                                              |
| POS vocabulary a generic package might reach for        | **base list**                                                                          |
| workforce / registro de jornada vocabulary              | `WORKFORCE_ES_VOCABULARY`                                                              |

- **`packages/fiscal-verifactu/src/vocabulary.ts`** exports `FISCAL_VOCABULARY: readonly string[]`,
  re-exported from the barrel beside `FISCAL_ENROLMENT` / `FISCAL_MIGRATIONS`.
- **`packages/workforce-es/src/vocabulary.ts`** exports `WORKFORCE_ES_VOCABULARY`, re-exported beside
  `WORKFORCE_ES_MIGRATIONS`.
- **`apps/server/src/modules.ts`** wires `vocabulary: FISCAL_VOCABULARY` on the `fiscal` descriptor and
  `vocabulary: WORKFORCE_ES_VOCABULARY` on `workforce-es` — the composition root injects, the package
  declares, exactly the `FISCAL_ENROLMENT` shape.
  _(2026-09-06, SP-3c: that wiring moved with the list — the descriptors now live in
  `packages/composition/src/modules.ts`. The seat and its shape are unchanged. See
  [`2026-09-05-module-sp3c-gated-provisioning-design.md`](2026-09-05-module-sp3c-gated-provisioning-design.md).)_
- Both packages are already outside the guard's scan (neither is in `GENERIC_PACKAGES`), so a file of
  Spanish words in each needs no exclusion.

`workforce-es` uses words the fiscal list carries (`registro`, `hora`, `fecha`, `periodo`; measured
2026-09-05: `registro`×27, `hora`×12, `fecha`×11) and words the base list carries (`linea`/`lineas`).
It does not need to declare them: a declaration adds a word to the forbidden set, and those are
forbidden already. The labour section moves as it is.

## 4. The guard file after the change

`packages/db/src/english-only.ts` becomes the **mechanism plus the base list**:

- `GENERIC_PACKAGES` — unchanged, still explicit, still pinned by name in the suite.
- `EXEMPT_PACKAGES` — **deleted**. Its one live use was the suite's assertion that no exempt package
  is generic; that assertion now runs over the derived owners (§5). `packages/verifactu` (the AEAT
  library, no descriptor) becomes an unlisted library like `provisioning`, `tunnel` and `ui`: not
  generic, not scanned; CLAUDE.md §3 records it.
- `SPANISH_WORDS` — keeps its export name (it is cited by name in a dozen comments, half of which stay
  true) and becomes the **base list**: the POS section plus `descripcion`/`descripciones`. Its doc
  says what it now is and points at the seat.
- `findSpanish(source, words)` — the word set becomes a **required** parameter with no default, so no
  caller can silently narrow to the base list. Every caller names the set it means.
- Two new pure, typechecked helpers (in this file so the root project measures them at 98/98/98/95):

  ```ts
  /** Structural on purpose: importing WaitronModule from @waitron/module would give packages/db a
   * dev-only dependency cycle (module → migrations → db). Only these two fields are read. */
  export interface VocabularyDeclaration {
    readonly name: string;
    readonly migrations: { readonly from: string };
    readonly vocabulary?: readonly string[];
  }
  export interface VocabularyOwner {
    readonly module: string; // descriptor name, e.g. "fiscal"
    readonly packageDir: string; // derived, e.g. "fiscal-verifactu"
    readonly terms: readonly string[];
  }
  /** Every module declaring a vocabulary (an empty declaration is returned too, so the suite can
   * reject it by name), with the package dir derived from `migrations.from` (`../<pkg>/drizzle`).
   * Throws on a `from` of any other shape. */
  export function vocabularyOwners(modules: readonly VocabularyDeclaration[]): VocabularyOwner[];
  /** base ∪ every owner's terms. */
  export function forbiddenVocabulary(base: ReadonlySet<string>, modules: readonly VocabularyDeclaration[]): Set<string>;
  ```

- `SELF`, the tokeniser, `sourceFilesIn`, the `apps/*` decision block and the "there is deliberately no
  exception list" note — unchanged.

## 5. The root suite (`scripts/english-only.test.ts`)

Imports `ALL_MODULES` from `../apps/server/src/modules.js` — the precedent is
`scripts/module-graph-honesty.test.ts`, in the same root project; like it, the import is used for
runtime values only because the root project is not typechecked (CLAUDE.md §2). Then:

1. **Configuration pins.** `GENERIC_PACKAGES` equals its twenty names (kept). The derived owner set
   equals `[fiscal → fiscal-verifactu, workforce-es → workforce-es]` — the vacuous-pass anchor that
   the derivation found the real owners, replacing today's `EXEMPT_PACKAGES` pin. No owner's package
   is in `GENERIC_PACKAGES`.
2. **Declaration shape.** Each declared list is non-empty, every token matches `^[a-z]+$`, no list
   repeats a token, and `base ∩ modules = ∅` (§2).
3. **Positive control per owner, proven by deletion.** The owner's own terms fire on the owner's own
   `src/` (measured 2026-09-05: `registros.ts` yields `registro`/`registros`/`facturacion`/`huella`/
   `secuencia`; `convenio-config.ts` holds `convenio`×19 and `registro-jornada.ts` `jornada`×9 as
   raw case-insensitive occurrences, 7 and 4 after the guard's own comment stripping and
   tokenising).
   This replaces "the wordlist is not decorative", which scanned `packages/verifactu` — a library
   that now sits in no list. The declaration file (`vocabulary.ts`) is excluded from this scan —
   every declared term is a literal there and would satisfy any anchor.
4. **The generic scan** with `forbiddenVocabulary(SPANISH_WORDS, ALL_MODULES)`.
5. The existing `findSpanish` unit tests (identifier, string literal, accents, comments, shared words,
   NIF, whole-token matching) run against a fixed local set, so a change to a module's declaration
   cannot redden a test about tokenising; one test contrasts the base list with the assembled set to
   show the parameter is honoured.

## 6. Consumers that change

- **`packages/fiscal-verifactu/src/vocabulary-scope.test.ts`.** Drops the source-text regexes over
  `GENERIC_PACKAGES`/`EXEMPT_PACKAGES`/`SPANISH_WORDS` (the root suite's derived assertions replace
  them). Keeps its verbatim tokeniser copy — `findSpanish` is deliberately not on `@waitron/db`'s
  barrel and the enumerated `exports` map forbids a deep import — and runs it over `schema/registros.ts`
  with the package's own `FISCAL_VOCABULARY`: the package-local positive control, which also measures
  `vocabulary.ts` for the package's own coverage. The "Task 11's guard is scoped to packages/fiscal"
  block stays.
- **`packages/workforce-es`** gains the same package-local positive control over
  `schema/convenio-config.ts`.
- **`packages/db/src/schema/series.test.ts`** "has no column relating a series to a chain". Its Spanish
  half called `findSpanish(n)` to catch `cadena`/`secuencia`/`huella`/`registro` — fiscal's words,
  which `packages/db` can no longer know; that is the inversion working. The test now (a) widens its
  English regex to the regime-neutral chain terms (`chain|hash|previous|link|sequence`) and (b) **pins
  the exact column set** of `invoice_series` (today: `code`, `id`, `next_number`, `node_id`,
  `purpose`, `tenant_id`), which is stricter than any wordlist — any new column is a deliberate edit to
  the pin. A Spanish column in this package's schema *source* is still caught by the tree guard on
  `series.ts`; what the pin adds is the hand-written-SQL case the guard never scanned.
- **Comment receipts the move falsifies** (CLAUDE.md §1: a behaviour change retires every receipt
  about the old behaviour). Grep `SPANISH_WORDS|EXEMPT_PACKAGES` across `packages/` and `apps/` and
  reword each that names a word now owned by a module — known today: `packages/workforce/src/errors.ts`
  (`ausencia`), `packages/workforce/src/schema/absences.ts` (`vacaciones`/`baja`/`permiso`),
  `packages/workforce/src/schema/employments.ts`, `packages/db/src/schema/sales.ts`
  (`destinatario`), `packages/db/src/schema/purchase-invoices.ts`, `packages/layouts/src/device-profile.ts`,
  `packages/db/src/index.ts` (names `EXEMPT_PACKAGES`), `packages/provisioning/src/fiscal-modules.ts`
  (`iva`; "neither `GENERIC_PACKAGES` nor `EXEMPT_PACKAGES`"). The ones citing base words (`venta`,
  `mesa`, `linea`) stay true and are left alone.
- **`packages/module/src/module.ts`** — the seat's doc comment carries §2's meaning; the type is
  unchanged. **`apps/server/src/modules.ts`**'s header names `vocabulary` among the populated seats.
  _(2026-09-06, SP-3c: that header now lives in `packages/composition/src/modules.ts`.)_
- **CLAUDE.md §3**, the "Spanish domain terms are deliberate" entry: a module declares its vocabulary
  on its descriptor's `vocabulary` seat; the guard's base list is generic POS Spanish only; the owner
  packages are derived from `migrations.from`; `packages/verifactu` is an unlisted library.
- **`docs/backlog.md`** gains the SP-3b landing row at land.

## 7. Invariants preserved (receipts)

- **The generic scan's verdict is unchanged.** The assembled set is a partition of today's list into
  three homes and back into a union, so `forbiddenVocabulary(base, ALL_MODULES)` equals today's
  `SPANISH_WORDS` element for element. The plan measures this **once**, before and after, as a set
  equality — not a permanent pin of ~170 literals in the suite (a count is a receipt that goes stale,
  CLAUDE.md §7).
- **No new exemption for a generic package** (architecture §9): `GENERIC_PACKAGES` is untouched and the
  derived owners are exactly the two packages exempt today minus a library that was never scanned.
- **No runtime change.** The seat has no reader outside the root suite; boot, provisioning and sync do
  not read `vocabulary`.

## 8. Why the generic list stays explicit (measured, not assumed)

The natural end state of the inversion is "scan everything under `packages/` except the derived
owners". Measured 2026-09-05 by running today's `findSpanish` over every package in neither list:

| package          | files | Spanish hits |
| ---------------- | ----- | ------------ |
| provisioning     | 34    | 155          |
| ui               | 45    | 8            |
| migrations       | 8     | 2            |
| payments-stripe  | 43    | 0            |
| tunnel           | 9     | 0            |

`provisioning` speaks fiscal vocabulary on purpose (`obligado`, `sistema informatico`, the `"iva"` tax
id — SP-3c's seam, not this slice's). Flipping the scope is a separate decision with its own fallout;
this slice changes *who declares* the words, not *where* they are looked for.

## 9. Proven by deletion

- Remove `huella` from `FISCAL_VOCABULARY` → the fiscal positive control (§5.3) goes red.
- Remove `convenio` and `jornada` from `WORKFORCE_ES_VOCABULARY` → the workforce-es positive control
  goes red.
- Add `const huella = 1;` to a generic package → the generic scan goes red naming the file and word.
- Add `"fiscal-verifactu"` to `GENERIC_PACKAGES` → the derived-owner assertion goes red.
- Add `"huella"` to the base list → the disjointness assertion goes red naming the owner.
- Change fiscal's `migrations.from` to a non-`../<pkg>/drizzle` shape → `vocabularyOwners` throws.
- Add a term that occurs nowhere in the owner's real source to its declaration and its anchors → the
  positive control goes red (the declaration file is excluded from the scan).

## 10. Interactions

- **SP-3c / SP-3d / `fiscal-none`** — independent. `fiscal-none` will declare no vocabulary (it is
  English), so the derived owner set does not change when it lands; a second real regime declares its
  own list in its own package and never touches `packages/db`.
- **Track A (data layer)** — its migration squash edits `packages/db/drizzle/`, not `english-only.ts`;
  any overlap is textual. CLAUDE.md §3 is Track C's section under the coordination rules.
- **Track B** — no shared files.

## 11. What this does not touch

The tokeniser and comment stripping; `GENERIC_PACKAGES`; the `apps/*` decision; `SELF`;
`packages/fiscal`'s `no-regime-vocabulary.test.ts`; error-code registries; any runtime path; any
migration; any test that cites a **base** word in a comment.
