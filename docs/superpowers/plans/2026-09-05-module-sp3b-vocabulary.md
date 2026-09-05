# SP-3b — Module-owned vocabulary — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the fiscal and labour Spanish wordlists out of `packages/db`'s english-only guard into the packages that own them, declared on each module descriptor's `vocabulary` seat, with the root suite assembling the forbidden set and deriving the owner packages — so no future module edits a core file to declare its vocabulary.

**Architecture:** Each owning package exports a `readonly string[]` constant (`FISCAL_VOCABULARY`, `WORKFORCE_ES_VOCABULARY`), the composition root wires it onto the descriptor, and `packages/db/src/english-only.ts` becomes mechanism + a base list: `findSpanish(source, words)` takes its word set, `vocabularyOwners(modules)` derives `{ module, packageDir, terms }` from `migrations.from`, `forbiddenVocabulary(base, modules)` unions. `EXEMPT_PACKAGES` is deleted; `GENERIC_PACKAGES` stays explicit. The assembled set equals today's list exactly, so no generic package's verdict changes.

**Tech Stack:** TypeScript, Vitest (root project + per-package), pnpm workspace. No new dependency, no migration, no runtime change.

**Spec:** `docs/superpowers/specs/2026-09-05-module-sp3b-vocabulary-design.md` — read it first; the plan argues from it.

## Global Constraints

- **Worktree:** all work happens in `/Users/clintongormley/workspace/worktrees/waitron-feat-module-sp3b-vocabulary` on branch `feat/module-sp3b-vocabulary`. Never commit to `main`.
- **Every commit is `git commit -s`** (DCO; CI's `dco` job walks the whole PR range).
- **Generic packages stay English.** You are editing the guard that enforces this; never put a Spanish word in a `packages/<generic>/src` file outside `english-only.ts`'s base list (the file is in `SELF`, so it may hold them). `docs/` and `scripts/` are never scanned, so the plan may spell the words out.
- **Verbatim moves only.** Every word in today's `SPANISH_WORDS` ends up in exactly one of: the base list, `FISCAL_VOCABULARY`, `WORKFORCE_ES_VOCABULARY`. Task 3 measures that the union equals today's set.
- **Token contract** (spec §2): lowercase ASCII `a–z` only, unaccented, singular and plural listed separately, nothing stemmed.
- **No runtime consumer.** Nothing at boot, provisioning or sync reads `vocabulary`; do not add one.
- **Per-task verification** includes `pnpm format:check` (whole workspace — it is fast) plus the named package's `lint`/`typecheck`/tests. Real-PG suites need `TESTCONTAINERS_RYUK_DISABLED=true`.
- **Coverage thresholds:** `packages/db`'s `english-only.ts` is measured by the ROOT project (`pnpm vitest run --coverage` at the repo root, thresholds 98/98/98/95); `packages/fiscal-verifactu` and `packages/workforce-es` carry 98/98/98/95 in their own configs. A new exported const is covered by any test importing it.
- **Comments state the invariant, not the history** (CLAUDE.md §1). No "moved in SP-3b" narratives; a one-line spec pointer at most.
- **Do not run two browser-mode test gates at once** and never background `pnpm -r test:coverage`. Before any `git push`, `pgrep -f .husky/pre-push` must print nothing.

---

### Task 1: `FISCAL_VOCABULARY` — the fiscal module declares its terms

**Files:**
- Create: `packages/fiscal-verifactu/src/vocabulary.ts`
- Modify: `packages/fiscal-verifactu/src/index.ts` (barrel)
- Modify: `packages/fiscal-verifactu/src/vocabulary-scope.test.ts` (rewrite)
- Modify: `apps/server/src/modules.ts` (fiscal descriptor gains `vocabulary`)
- Modify: `apps/server/src/modules.test.ts` (pin)

**Interfaces:**
- Produces: `export const FISCAL_VOCABULARY: readonly string[]` from `@waitron/fiscal-verifactu`; `ALL_MODULES.find(m => m.name === "fiscal").vocabulary === FISCAL_VOCABULARY`.

- [ ] **Step 1: Rewrite the package-local test as the failing test**

Replace the whole of `packages/fiscal-verifactu/src/vocabulary-scope.test.ts` with:

```ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FISCAL_VOCABULARY } from "./vocabulary.js";

/**
 * The english-only guard's tokeniser (packages/db/src/english-only.ts), copied verbatim rather than
 * imported: `findSpanish` is deliberately NOT on `@waitron/db`'s barrel (index.ts — the file computes
 * `PACKAGES_ROOT` from `import.meta.dirname` at load time, which drizzle-kit's loader cannot supply),
 * and the package's enumerated `exports` map forbids a deep import.
 */
function tokenise(line: string): string[] {
  return line
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter(Boolean);
}

function tokensOf(relativePath: string): Set<string> {
  const source = readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
  return new Set(tokenise(source));
}

describe("FISCAL_VOCABULARY — the terms this module owns (module-system §3, SP-3b spec §2)", () => {
  it("is a non-empty list of guard-shaped tokens with no duplicates", () => {
    expect(FISCAL_VOCABULARY.length).toBeGreaterThan(0);
    for (const term of FISCAL_VOCABULARY) expect(term).toMatch(/^[a-z]+$/);
    expect(new Set(FISCAL_VOCABULARY).size).toBe(FISCAL_VOCABULARY.length);
  });

  it("fires on this package's own schema, so the declaration is not decorative", () => {
    // The root suite (scripts/english-only.test.ts) proves the same over the whole package; this
    // local control keeps the list honest when only this package's own gate runs. Delete `huella`
    // from the list and this goes red.
    const tokens = tokensOf("./schema/registros.ts");
    const fired = FISCAL_VOCABULARY.filter((w) => tokens.has(w));
    expect(fired).toEqual(
      expect.arrayContaining(["registro", "registros", "facturacion", "huella", "secuencia"]),
    );
  });
});

/**
 * The reverse direction: packages/fiscal's narrower guard (no-regime-vocabulary.test.ts, which forbids
 * ENGLISH regime terms in the regime-neutral contract package) must not reach INTO this package. That
 * guard has no exported surface — its `sources` come from `import.meta.glob(["./**\/*.ts", ...])`,
 * resolved relative to the FILE THAT CALLS IT, so a relative, non-parent-escaping glob is structurally
 * incapable of walking out of `packages/fiscal/src`. Proving that without importing its internals
 * means reading its source text.
 */
describe("packages/fiscal's no-regime-vocabulary guard is scoped to packages/fiscal, not here", () => {
  const noRegimeVocabularySource = readFileSync(
    fileURLToPath(new URL("../../fiscal/src/no-regime-vocabulary.test.ts", import.meta.url)),
    "utf8",
  );

  it("gathers its sources with a relative glob rooted at its own file", () => {
    expect(noRegimeVocabularySource).toContain('import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]');
  });

  it("never mentions this package, by path or by name", () => {
    expect(noRegimeVocabularySource).not.toContain("fiscal-verifactu");
    expect(noRegimeVocabularySource).not.toContain("../");
  });
});
```

- [ ] **Step 2: Run it to confirm it fails for the right reason**

Run: `pnpm --filter @waitron/fiscal-verifactu test vocabulary-scope`
Expected: FAIL — `Cannot find module './vocabulary.js'` (or an equivalent unresolved-import error). Anything else means the test file itself is wrong.

- [ ] **Step 3: Create the vocabulary file**

Create `packages/fiscal-verifactu/src/vocabulary.ts`:

```ts
/**
 * The Spanish terms this module OWNS (module-system architecture §3; SP-3b spec §2–§3): legitimate
 * inside this package, forbidden in every generic package. Declared here and wired onto the `fiscal`
 * descriptor's `vocabulary` seat by the composition root (`apps/server/src/modules.ts`); read only by
 * the root english-only suite, which assembles the forbidden set from every module's declaration.
 * Nothing at runtime consults it.
 *
 * Tokens, not words — the guard's tokeniser contract (`packages/db/src/english-only.ts`): lowercase
 * ASCII, accents already removed (`anulación` and `anulacion` are one token), singular and plural
 * listed separately, nothing stemmed (stemming `series` to `serie` would fire on `invoice_series`).
 * Words identical in both languages (total, base, local, error, real, id) and the acronym `nif` are
 * deliberately absent: a guard that fires on `sales.total` on day one is deleted on day two.
 */
export const FISCAL_VOCABULARY: readonly string[] = [
  // chain and record vocabulary — the naming contract's module tables
  "registro",
  "registros",
  "huella",
  "huellas",
  "cadena",
  "cadenas",
  "encadenamiento",
  "secuencia",
  "secuencias",
  "primer",
  "primero",
  // invoice vocabulary
  "factura",
  "facturas",
  "facturacion",
  "alta",
  "altas",
  "anulacion",
  "anulaciones",
  "rectificativa",
  "rectificativas",
  "desglose",
  "desgloses",
  "serie",
  "numero",
  "numeros",
  "importe",
  "importes",
  "cuota",
  "cuotas",
  "impuesto",
  "impuestos",
  "iva",
  // parties and identity
  "obligado",
  "obligados",
  "emisor",
  "emisores",
  "destinatario",
  "destinatarios",
  "tercero",
  "terceros",
  "cliente",
  "clientes",
  "usuario",
  "usuarios",
  "empresa",
  "empresas",
  "nombre",
  "nombres",
  "razon",
  "tributario",
  "instalacion",
  "informatico",
  "informatica",
  "sistema",
  // submission vocabulary
  "envio",
  "envios",
  "incidencia",
  "incidencias",
  "suministro",
  "consulta",
  "respuesta",
  "cabecera",
  "detalle",
  "detalles",
  "presentacion",
  "expedicion",
  "periodo",
  "ejercicio",
  "operacion",
  "operaciones",
  // time — AEAT's FechaHoraHusoGenRegistro
  "fecha",
  "fechas",
  "hora",
  "huso",
  // registros_facturacion.entorno — Waitron's own environment stamp, on a fiscal column
  "entorno",
  "entornos",
];
```

- [ ] **Step 4: Export it from the barrel**

In `packages/fiscal-verifactu/src/index.ts`, after the line `export { FISCAL_ENROLMENT } from "./enrolment.js";` add:

```ts
export { FISCAL_VOCABULARY } from "./vocabulary.js";
```

- [ ] **Step 5: Run the package test and confirm it passes**

Run: `pnpm --filter @waitron/fiscal-verifactu test vocabulary-scope`
Expected: PASS (4 tests).

- [ ] **Step 6: Write the failing composition-root pin**

In `apps/server/src/modules.test.ts`, add to the imports:

```ts
import { FISCAL_VOCABULARY } from "@waitron/fiscal-verifactu";
```

and append a new describe block at the end of the file:

```ts
describe("ALL_MODULES vocabulary seat (SP-3b)", () => {
  it("fiscal declares the fiscal module's own vocabulary, by reference", () => {
    const fiscal = ALL_MODULES.find((m) => m.name === "fiscal");
    expect(fiscal?.vocabulary).toBe(FISCAL_VOCABULARY);
  });
});
```

Run: `pnpm --filter @waitron/server test modules.test`
Expected: FAIL — `expected undefined to be [ 'registro', … ]`.

- [ ] **Step 7: Wire the seat**

In `apps/server/src/modules.ts`:

Change the import line
```ts
import { FISCAL_ENROLMENT } from "@waitron/fiscal-verifactu";
```
to
```ts
import { FISCAL_ENROLMENT, FISCAL_VOCABULARY } from "@waitron/fiscal-verifactu";
```

In the `fiscal` descriptor, after `sync: FISCAL_ENROLMENT,` add:
```ts
    vocabulary: FISCAL_VOCABULARY,
```

- [ ] **Step 8: Verify**

Run:
```bash
pnpm --filter @waitron/server test modules.test
pnpm --filter @waitron/fiscal-verifactu typecheck && pnpm --filter @waitron/server typecheck
pnpm --filter @waitron/fiscal-verifactu lint && pnpm --filter @waitron/server lint
pnpm format:check
```
Expected: all PASS / exit 0. Run `pnpm exec prettier --write` over the files you touched FIRST, then `format:check`; the test blocks above were written by hand and a few lines exceed prettier's width.

- [ ] **Step 9: Commit**

```bash
git add packages/fiscal-verifactu/src/vocabulary.ts packages/fiscal-verifactu/src/index.ts packages/fiscal-verifactu/src/vocabulary-scope.test.ts apps/server/src/modules.ts apps/server/src/modules.test.ts
git commit -s -m "SP-3b: fiscal module declares its own vocabulary (FISCAL_VOCABULARY)"
```

---

### Task 2: `WORKFORCE_ES_VOCABULARY` — the Spain labour module declares its terms

**Files:**
- Create: `packages/workforce-es/src/vocabulary.ts`
- Create: `packages/workforce-es/src/vocabulary.test.ts`
- Modify: `packages/workforce-es/src/index.ts` (barrel)
- Modify: `apps/server/src/modules.ts` (workforce-es descriptor gains `vocabulary`)
- Modify: `apps/server/src/modules.test.ts` (pin)

**Interfaces:**
- Produces: `export const WORKFORCE_ES_VOCABULARY: readonly string[]` from `@waitron/workforce-es`; `ALL_MODULES.find(m => m.name === "workforce-es").vocabulary === WORKFORCE_ES_VOCABULARY`.

- [ ] **Step 1: Write the failing package-local test**

Create `packages/workforce-es/src/vocabulary.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { WORKFORCE_ES_VOCABULARY } from "./vocabulary.js";

/**
 * The english-only guard's tokeniser (packages/db/src/english-only.ts), copied verbatim: `findSpanish`
 * is deliberately not on `@waitron/db`'s barrel (index.ts) and the enumerated `exports` map forbids a
 * deep import — the same stance packages/fiscal-verifactu's vocabulary-scope.test.ts takes.
 */
function tokenise(line: string): string[] {
  return line
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter(Boolean);
}

function tokensOf(relativePath: string): Set<string> {
  const source = readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
  return new Set(tokenise(source));
}

describe("WORKFORCE_ES_VOCABULARY — the terms this module owns (module-system §3, SP-3b spec §2)", () => {
  it("is a non-empty list of guard-shaped tokens with no duplicates", () => {
    expect(WORKFORCE_ES_VOCABULARY.length).toBeGreaterThan(0);
    for (const term of WORKFORCE_ES_VOCABULARY) expect(term).toMatch(/^[a-z]+$/);
    expect(new Set(WORKFORCE_ES_VOCABULARY).size).toBe(WORKFORCE_ES_VOCABULARY.length);
  });

  it("fires on this package's own source, so the declaration is not decorative", () => {
    // `convenio` names the schema's table; `jornada` is the registro de jornada itself. Delete either
    // from the list and this goes red. The root suite proves the same over the whole package.
    const schema = tokensOf("./schema/convenio-config.ts");
    const jornada = tokensOf("./registro-jornada.ts");
    expect(WORKFORCE_ES_VOCABULARY.filter((w) => schema.has(w))).toContain("convenio");
    expect(WORKFORCE_ES_VOCABULARY.filter((w) => jornada.has(w))).toContain("jornada");
  });
});
```

- [ ] **Step 2: Run it to confirm it fails for the right reason**

Run: `pnpm --filter @waitron/workforce-es test vocabulary.test`
Expected: FAIL — unresolved import `./vocabulary.js`.

- [ ] **Step 3: Create the vocabulary file**

Create `packages/workforce-es/src/vocabulary.ts`:

```ts
/**
 * The Spanish labour terms this module OWNS (module-system architecture §3; SP-3b spec §2–§3):
 * legitimate inside this package, forbidden in every generic package — in particular in
 * packages/workforce, the English generic package this Spain module sits over. Wired onto the
 * `workforce-es` descriptor's `vocabulary` seat by the composition root (`apps/server/src/modules.ts`)
 * and read only by the root english-only suite. Nothing at runtime consults it.
 *
 * Tokens, not words — the guard's tokeniser contract (`packages/db/src/english-only.ts`): lowercase
 * ASCII, unaccented, singular and plural listed separately, nothing stemmed. Terms this package also
 * uses but does not own (`registro`, `hora`, `fecha`, `periodo` — fiscal's; `linea`/`lineas` — the
 * guard's base list) are deliberately not repeated here: a declaration adds a word to the forbidden
 * set, and those are forbidden already.
 */
export const WORKFORCE_ES_VOCABULARY: readonly string[] = [
  "jornada",
  "jornadas",
  "empleado",
  "empleados",
  "trabajador",
  "trabajadores",
  "trabajo",
  "fichaje",
  "fichajes",
  "presencia",
  "descanso",
  "descansos",
  "ausencia",
  "ausencias",
  "turno",
  "turnos",
  "horario",
  "horarios",
  "nocturnidad",
  "festivo",
  "festivos",
  "vacaciones",
  "permiso",
  "permisos",
  "baja",
  "bajas",
  "finiquito",
  "contrato",
  "contratos",
  "salario",
  "salarios",
  "nomina",
  "nominas",
  "convenio",
  "convenios",
  "retribucion",
];
```

- [ ] **Step 4: Export it from the barrel**

In `packages/workforce-es/src/index.ts`, after the line `export { WORKFORCE_ES_MIGRATIONS } from "./migrations.js";` add:

```ts
export { WORKFORCE_ES_VOCABULARY } from "./vocabulary.js";
```

- [ ] **Step 5: Run the package test and confirm it passes**

Run: `pnpm --filter @waitron/workforce-es test vocabulary.test`
Expected: PASS (2 tests).

- [ ] **Step 6: Extend the composition-root pin (failing first)**

In `apps/server/src/modules.test.ts`, add the import:

```ts
import { WORKFORCE_ES_VOCABULARY } from "@waitron/workforce-es";
```

and inside the `describe("ALL_MODULES vocabulary seat (SP-3b)")` block from Task 1 add:

```ts
  it("workforce-es declares the Spain labour module's own vocabulary, by reference", () => {
    const wfes = ALL_MODULES.find((m) => m.name === "workforce-es");
    expect(wfes?.vocabulary).toBe(WORKFORCE_ES_VOCABULARY);
  });
  it("no other module declares vocabulary — the generic modules are English", () => {
    const owners = ALL_MODULES.filter((m) => m.vocabulary !== undefined).map((m) => m.name);
    expect(owners).toEqual(["workforce-es", "fiscal"]);
  });
```

Run: `pnpm --filter @waitron/server test modules.test`
Expected: FAIL on the workforce-es pin (`expected undefined to be [...]`) and on the owners list (`["fiscal"]` ≠ `["workforce-es", "fiscal"]`).

- [ ] **Step 7: Wire the seat**

In `apps/server/src/modules.ts` add the import (keep imports alphabetised by package as the file already is — `@waitron/workforce-es` goes after `@waitron/sync`'s type import):

```ts
import { WORKFORCE_ES_VOCABULARY } from "@waitron/workforce-es";
```

In the `workforce-es` descriptor, after its `migrations: { … }` object add:

```ts
    vocabulary: WORKFORCE_ES_VOCABULARY,
```

Then rewrite the LAST paragraph of the file's header comment (the one beginning "The `sync` seat is now POPULATED") to:

```ts
 * The `sync` seat is POPULATED on `core`/`identity`/`payments`/`fiscal` (SP-2a, SP-3a): each owning
 * package declares its own enrolment array and the composition root injects it here, so
 * `@waitron/sync` imports no domain schema. The `vocabulary` seat is POPULATED on `fiscal` and
 * `workforce-es` (SP-3b): each Spanish-by-design package exports the terms it owns
 * (`FISCAL_VOCABULARY`/`WORKFORCE_ES_VOCABULARY`) and the root english-only suite assembles the
 * forbidden set from these declarations, deriving each owner's package dir from `migrations.from`.
 * Every OTHER descriptor carries neither — nothing else enrols, and the generic modules are English.
 * `cards` and the remaining seats are still declared on the contract but stay empty until their own
 * slices land.
 */
```

- [ ] **Step 8: Verify**

Run:
```bash
pnpm --filter @waitron/server test modules.test
pnpm --filter @waitron/workforce-es typecheck && pnpm --filter @waitron/server typecheck
pnpm --filter @waitron/workforce-es lint && pnpm --filter @waitron/server lint
pnpm --filter @waitron/workforce-es test:coverage
pnpm format:check
```
Expected: all PASS; the workforce-es coverage run stays above 98/98/98/95 (the new file is a single const, covered by its test).

- [ ] **Step 9: Commit**

```bash
git add packages/workforce-es/src/vocabulary.ts packages/workforce-es/src/vocabulary.test.ts packages/workforce-es/src/index.ts apps/server/src/modules.ts apps/server/src/modules.test.ts
git commit -s -m "SP-3b: workforce-es declares its own vocabulary (WORKFORCE_ES_VOCABULARY)"
```

---

### Task 3: The guard reads the descriptors — `english-only.ts` refactor + root suite rewrite

**Files:**
- Modify: `packages/db/src/english-only.ts`
- Modify: `scripts/english-only.test.ts` (rewrite)
- Modify: `packages/db/src/schema/series.test.ts` (its one `findSpanish` call — kept in this task so the commit typechecks)
- Scratch (not committed): `<scratchpad>/vocab-before.json`, `<scratchpad>/vocab-*.mts`

**Interfaces:**
- Consumes: `FISCAL_VOCABULARY`, `WORKFORCE_ES_VOCABULARY` via `ALL_MODULES` (Tasks 1–2).
- Produces, from `packages/db/src/english-only.ts`:
  - `findSpanish(source: string, words: ReadonlySet<string>): Violation[]` — `words` REQUIRED.
  - `SPANISH_WORDS: Set<string>` — now the BASE list only.
  - `interface VocabularyDeclaration { name: string; migrations: { from: string }; vocabulary?: readonly string[] }`
  - `interface VocabularyOwner { module: string; packageDir: string; terms: readonly string[] }`
  - `vocabularyOwners(modules: readonly VocabularyDeclaration[]): VocabularyOwner[]`
  - `forbiddenVocabulary(base: ReadonlySet<string>, modules: readonly VocabularyDeclaration[]): Set<string>`
  - `EXEMPT_PACKAGES` is REMOVED.

- [ ] **Step 1: Record today's full wordlist before touching anything**

Set `SCRATCH` to the session scratchpad directory. Create `$SCRATCH/vocab-before.mts`:

```ts
import { writeFileSync } from "node:fs";
import { SPANISH_WORDS } from "/Users/clintongormley/workspace/worktrees/waitron-feat-module-sp3b-vocabulary/packages/db/src/english-only.ts";
writeFileSync(process.argv[2]!, JSON.stringify([...SPANISH_WORDS].sort(), null, 2));
console.log(SPANISH_WORDS.size, "words recorded");
```

Run: `node --experimental-strip-types $SCRATCH/vocab-before.mts $SCRATCH/vocab-before.json 2>&1 | grep -v ExperimentalWarning`
Expected: prints `N words recorded` (N is today's size; it must be > 100) and writes the JSON. Keep the file for Step 8.

- [ ] **Step 2: Rewrite the root suite as the failing test**

Replace the whole of `scripts/english-only.test.ts` with:

```ts
/**
 * The English-only vocabulary guard's suite. It scans the twenty generic packages' `src/`, so it
 * polices the tree rather than any one package, and lives in the repo-level Vitest project for that
 * reason — see the repo-root `vitest.config.ts` for what that project is and which two gates run it.
 *
 * The forbidden set is ASSEMBLED here, not listed in one place (SP-3b): `packages/db/src/english-only.ts`
 * holds only the base list of generic Spanish no module owns, and every Spanish-by-design module
 * declares its own terms on its descriptor's `vocabulary` seat (`apps/server/src/modules.ts`). This
 * suite derives each owner's package dir from `migrations.from` (the same derivation
 * `module-graph-honesty.test.ts` uses), asserts no owner is a generic package, and proves each
 * declaration fires on its owner's real source. `ALL_MODULES` is imported for runtime values only —
 * the root project is not typechecked (CLAUDE.md §2).
 *
 * `english-only.ts` stays in `packages/db` because `packages/db/src/schema/series.test.ts` imports
 * `findSpanish` from it; the root config measures its coverage and `packages/db`'s config excludes it.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ALL_MODULES } from "../apps/server/src/modules.js";
import {
  GENERIC_PACKAGES,
  PACKAGES_ROOT,
  SELF,
  SPANISH_WORDS,
  findSpanish,
  forbiddenVocabulary,
  readSource,
  sourceFilesIn,
  vocabularyOwners,
} from "../packages/db/src/english-only.js";

const OWNERS = vocabularyOwners(ALL_MODULES);
const FORBIDDEN = forbiddenVocabulary(SPANISH_WORDS, ALL_MODULES);

/**
 * Per-owner vacuous-pass anchors: terms each declaration MUST find in its owner's real source. A new
 * owner must add a row here (the "every owner has an anchor" test below insists), so a declaration
 * can never pass empty — the same reason module-graph-honesty pins its three known edges.
 */
const ANCHORS: Record<string, readonly string[]> = {
  fiscal: ["huella", "registro", "facturacion"],
  "workforce-es": ["convenio", "jornada"],
};

const discovered = GENERIC_PACKAGES.flatMap((name) =>
  sourceFilesIn(name).map((file) => [`${name}: ${file.replace(PACKAGES_ROOT, "")}`, file] as const),
);

describe("configuration", () => {
  it("scopes itself to the twenty generic packages", () => {
    expect([...GENERIC_PACKAGES]).toEqual([
      "db",
      "core",
      "fiscal",
      "shared",
      "payments",
      "scheduler",
      "credentials",
      "workforce",
      "reporting",
      "identity",
      "catalogue",
      "sync",
      "membership",
      "module",
      "layouts",
      "recipes",
      "purchasing",
      "printing",
      "diagnostics",
      "sync-enrolment",
    ]);
  });

  it("derives the vocabulary owners from the descriptors, in ALL_MODULES order", () => {
    // The vacuous-pass anchor for the derivation itself: these are the two Spanish-by-design
    // packages, resolved from `migrations.from` — `fiscal` names the SLOT, `fiscal-verifactu` the
    // package filling it. A third owner appears here the day a module declares vocabulary.
    expect(OWNERS.map((o) => [o.module, o.packageDir])).toEqual([
      ["workforce-es", "workforce-es"],
      ["fiscal", "fiscal-verifactu"],
    ]);
  });

  it("never scans a vocabulary owner's package", () => {
    // A module's terms are legitimate inside its own package by definition (spec §2); listing that
    // package as generic would make the guard fail on the vocabulary it exists to define.
    for (const owner of OWNERS) {
      expect(GENERIC_PACKAGES).not.toContain(owner.packageDir);
    }
  });

  it("excludes only the files that define a forbidden-vocabulary list, by exact name", () => {
    // A wildcard here (say, *.test.ts) would silently drop every test file in packages/db out of
    // scope, which is where fixture names live.
    expect([...SELF]).toEqual(["english-only.ts", "no-regime-vocabulary.test.ts"]);
  });

  it("cannot reach this suite, so it needs no exemption", () => {
    const scanned = GENERIC_PACKAGES.flatMap((name) => sourceFilesIn(name));
    expect(scanned.some((file) => file.endsWith("english-only.test.ts"))).toBe(false);
    expect(scanned.length).toBeGreaterThan(0);
  });

  it("returns nothing for a package that does not exist on disk", () => {
    // A name in GENERIC_PACKAGES with no directory yet is silence, not a crash: the guard has to be
    // in place BEFORE a generic package is created. Deleting the `existsSync` line makes this throw.
    expect(sourceFilesIn("no-such-package")).toEqual([]);
  });

  it("discovers source files in every generic package that exists on disk", () => {
    // A guard whose file list is empty passes every assertion below it. This stops that.
    for (const name of GENERIC_PACKAGES) {
      const dir = join(PACKAGES_ROOT, name, "src");
      if (!existsSync(dir)) continue;
      expect(sourceFilesIn(name).length).toBeGreaterThan(0);
    }
    expect(discovered.length).toBeGreaterThan(0);
  });
});

describe("each module's vocabulary declaration", () => {
  it("is non-empty, guard-shaped and free of duplicates", () => {
    // The tokeniser emits lowercase unaccented a–z runs; a declared term of any other shape can
    // never match and would be dead weight. An empty declaration is a mistake, not a module with
    // nothing to say (a module with nothing to say omits the seat).
    expect(OWNERS.length).toBeGreaterThan(0);
    for (const owner of OWNERS) {
      expect(owner.terms.length, owner.module).toBeGreaterThan(0);
      for (const term of owner.terms) expect(term, owner.module).toMatch(/^[a-z]+$/);
      expect(new Set(owner.terms).size, owner.module).toBe(owner.terms.length);
    }
  });

  it("has one declaring home per word: the base list re-absorbs no module's term", () => {
    // Two MODULES may share a word (a second fiscal regime will also say `huella`); the base list
    // may not — that is what stops the central list quietly growing back (spec §2).
    const clashes = OWNERS.flatMap((o) =>
      o.terms.filter((t) => SPANISH_WORDS.has(t)).map((t) => `${t} (owned by ${o.module})`),
    );
    expect(clashes).toEqual([]);
  });

  it("every owner has a vacuous-pass anchor", () => {
    expect(Object.keys(ANCHORS).sort()).toEqual(OWNERS.map((o) => o.module).sort());
  });

  it.each(OWNERS.map((o) => [o.module, o] as const))(
    "%s: fires on its owner's own source, so the declaration is not decorative",
    (module, owner) => {
      // Proves two things at once: the declaration matches vocabulary that actually occurs in the
      // owner's package, and the owner is excluded by SCOPE — not by a list too weak to fire on it.
      // Delete an anchor term from the module's list and this goes red.
      const files = sourceFilesIn(owner.packageDir);
      expect(files.length).toBeGreaterThan(0);
      const own = new Set(owner.terms);
      const fired = new Set(files.flatMap((f) => findSpanish(readSource(f), own)).map((v) => v.word));
      expect([...fired]).toEqual(expect.arrayContaining([...ANCHORS[module]!]));
    },
  );
});

describe("findSpanish", () => {
  it("flags a Spanish identifier", () => {
    const found = findSpanish("const ultimaHuella = head.lastHash;", FORBIDDEN);
    expect(found.map((v) => v.word)).toEqual(["huella"]);
  });

  it("flags a Spanish table name inside a string literal", () => {
    // The load-bearing case. No ESLint selector can see into this string, and this is the mistake
    // that reaches a migration and then a database.
    const found = findSpanish('export const records = pgTable("registros_facturacion", {});', FORBIDDEN);
    expect(found.map((v) => v.word)).toEqual(["registros", "facturacion"]);
  });

  it("flags a Spanish column name inside an object key", () => {
    const found = findSpanish('  numeroInstalacion: text("numero_instalacion"),', FORBIDDEN);
    expect(found.map((v) => v.word)).toEqual(["numero", "instalacion", "numero", "instalacion"]);
  });

  it("flags accented forms as well as unaccented", () => {
    // Both spellings occur in the sources — the XSDs are accented, the column names are not.
    expect(findSpanish("const anulación = 1;", FORBIDDEN).map((v) => v.word)).toEqual(["anulacion"]);
    expect(findSpanish("const anulacion = 1;", FORBIDDEN).map((v) => v.word)).toEqual(["anulacion"]);
    expect(findSpanish("const envío = 1;", FORBIDDEN).map((v) => v.word)).toEqual(["envio"]);
  });

  it("reports the line number", () => {
    const found = findSpanish("const ok = 1;\nconst cadena = 2;\n", FORBIDDEN);
    expect(found).toEqual([{ line: 2, word: "cadena", text: "const cadena = 2;" }]);
  });

  it("does not flag English words that contain a Spanish word", () => {
    // The whole difference between a guard people keep and a guard people disable. `series`
    // contains `serie`; `imported` contains `importe`; `delta` contains `alta`.
    expect(
      findSpanish(
        "import { invoiceSeries } from './series.js';\n" +
          "const importedRows = delta.filter((r) => r.renumbered);\n",
        FORBIDDEN,
      ),
    ).toEqual([]);
  });

  it("does not flag words shared by both languages", () => {
    // total, base, local, error, real: identical in Spanish and English, and all five appear in the
    // naming contract. Flagging them would make the guard fire on `sales.total` on its first day.
    expect(findSpanish("const { total, base, locale, error } = row;", FORBIDDEN)).toEqual([]);
  });

  it("does not flag NIF", () => {
    // tenants.nif is in the naming contract: a legal identifier and an acronym, not vocabulary.
    expect(findSpanish('nif: text("nif").notNull(),', FORBIDDEN)).toEqual([]);
  });

  it("ignores Spanish inside line and block comments", () => {
    // Comments explaining the regime are legitimate and wanted; the constraint is on identifiers
    // and table/column names.
    expect(findSpanish("// mirrors AEAT's registro de alta and its huella", FORBIDDEN)).toEqual([]);
    expect(
      findSpanish("/*\n * The cadena head. Spanish stays in the module.\n */", FORBIDDEN),
    ).toEqual([]);
  });

  it("still flags code on a line that also carries a comment", () => {
    const found = findSpanish("const cadena = 1; // the chain head", FORBIDDEN);
    expect(found.map((v) => v.word)).toEqual(["cadena"]);
  });

  it("scans with exactly the set it is handed — the base list alone knows no fiscal term", () => {
    // The parameter is required, with no default, so a caller can never silently narrow to the base
    // list: here the narrowing is deliberate and visible. `mesa` is base vocabulary, `huella` is
    // fiscal's.
    expect(findSpanish("const mesa = 1; const huella = 2;", SPANISH_WORDS).map((v) => v.word)).toEqual([
      "mesa",
    ]);
    expect(findSpanish("const mesa = 1; const huella = 2;", FORBIDDEN).map((v) => v.word)).toEqual([
      "mesa",
      "huella",
    ]);
  });

  it("permits the operation_description column named in the naming contract", () => {
    // Passes on its own merits rather than through an exception list: the column was renamed out of
    // Spanish, so it tokenises to `operation` and `description` and there is nothing to forgive.
    expect(findSpanish('operationDescription: text("operation_description"),', FORBIDDEN)).toEqual([]);
    // And the Spanish form it replaced is still caught, which stops the rename being reverted.
    expect(
      findSpanish('descriptionOperacion: text("description_operacion"),', FORBIDDEN).map((v) => v.word),
    ).toEqual(["operacion", "operacion"]);
    expect(findSpanish('tipoOperacion: text("tipo_operacion"),', FORBIDDEN).map((v) => v.word)).toEqual([
      "tipo",
      "operacion",
      "tipo",
      "operacion",
    ]);
  });
});

describe("the labour vocabulary fires", () => {
  it("flags Spanish labour identifiers and column names, so packages/workforce is guarded", () => {
    // workforce-es's declaration arms the guard over packages/workforce — an English generic package
    // sitting under a Spanish module — before the first Spanish labour name can land there.
    expect(findSpanish('jornadaLaboral: text("jornada_laboral"),', FORBIDDEN).map((v) => v.word)).toEqual([
      "jornada",
      "jornada",
    ]);
    expect(findSpanish("const fichaje = 1; const empleado = 2;", FORBIDDEN).map((v) => v.word)).toEqual([
      "fichaje",
      "empleado",
    ]);
  });

  it("does not flag English words that merely contain a labour token", () => {
    // Whole-token matching: `contract` is not `contrato`, `permission` is not `permiso`.
    expect(findSpanish("const contract = permission ?? baseline;", FORBIDDEN)).toEqual([]);
  });
});

describe("vocabularyOwners / forbiddenVocabulary", () => {
  const core = { name: "core", migrations: { from: "../db/drizzle" } };
  const spanish = {
    name: "regime",
    migrations: { from: "../regime-impl/drizzle" },
    vocabulary: ["huella", "cadena"] as const,
  };

  it("skips a module with no declaration and derives the package dir for one with", () => {
    expect(vocabularyOwners([core, spanish])).toEqual([
      { module: "regime", packageDir: "regime-impl", terms: ["huella", "cadena"] },
    ]);
  });

  it("refuses a declaring module whose migrations.from is not ../<pkg>/drizzle", () => {
    // The owner's package is DERIVED from `from`; a shape the derivation cannot read would silently
    // exempt nothing and scan nothing, so it is a loud descriptor bug instead.
    expect(() =>
      vocabularyOwners([{ ...spanish, migrations: { from: "./elsewhere" } }]),
    ).toThrow(/regime.*\.\.\/<pkg>\/drizzle/);
  });

  it("unions the base list with every declaration, without mutating the base", () => {
    const base = new Set(["mesa"]);
    const all = forbiddenVocabulary(base, [core, spanish]);
    expect([...all].sort()).toEqual(["cadena", "huella", "mesa"]);
    expect([...base]).toEqual(["mesa"]);
  });
});

describe("the package-local tokeniser copies", () => {
  // `findSpanish` is deliberately not importable from @waitron/db (its barrel says why: drizzle-kit
  // loads the barrel, and english-only.ts computes PACKAGES_ROOT from import.meta.dirname at load
  // time), so each vocabulary owner's package-local control carries a verbatim copy of `tokenise`.
  // This pins every copy byte-identical to the original, so a change to how the guard tokenises
  // cannot leave a package-local control silently disagreeing with the root guard.
  const TOKENISE = /function tokenise\(line: string\): string\[\] \{[\s\S]*?\n\}/;
  const original = TOKENISE.exec(readSource(join(PACKAGES_ROOT, "db", "src", "english-only.ts")))?.[0];

  it("finds the original to compare against", () => {
    expect(original).toBeDefined();
  });

  it.each(OWNERS.map((o) => [o.module, o.packageDir] as const))(
    "%s: its local copy is byte-identical to the guard's tokeniser",
    (_module, packageDir) => {
      const copies = sourceFilesIn(packageDir)
        .filter((f) => /vocabulary(-scope)?\.test\.ts$/.test(f))
        .map((f) => TOKENISE.exec(readSource(f))?.[0]);
      expect(copies).toHaveLength(1);
      expect(copies[0]).toBe(original);
    },
  );
});

describe.each(discovered)("%s", (_label, file) => {
  it("uses English vocabulary only", () => {
    const violations = findSpanish(readSource(file), FORBIDDEN);
    // Reported as formatted lines rather than a bare count: a failure needs to say which word on
    // which line, or the next person deletes the test.
    expect(violations.map((v) => `${v.line}: ${v.word} — ${v.text}`)).toEqual([]);
  });
});
```

- [ ] **Step 3: Run the root suite to confirm it fails for the right reason**

Run: `pnpm vitest run scripts/english-only.test.ts`
Expected: FAIL at import time — `forbiddenVocabulary`/`vocabularyOwners` are not exported (a `SyntaxError: The requested module … does not provide an export named 'forbiddenVocabulary'` or Vitest's equivalent).

- [ ] **Step 4: Refactor `packages/db/src/english-only.ts` — delete the exempt list**

Replace this block (lines 31–35 today):

```ts
/** Spanish by design: `verifactu`/`fiscal-verifactu` mirror AEAT's spec, XML and conformance
 * vectors; `workforce-es` is the Spain module for the registro de jornada, where the ET/RD-ley 8/2019
 * vocabulary (jornada, trabajador, conservación, Inspección) IS the domain language (sub-project 16,
 * mirroring the fiscal-verifactu precedent). */
export const EXEMPT_PACKAGES = ["verifactu", "fiscal-verifactu", "workforce-es"] as const;
```

with:

```ts
/**
 * There is no exempt-package list. A package is Spanish by design exactly when a module DECLARES
 * vocabulary (`WaitronModule.vocabulary`, the seat the composition root wires in
 * `apps/server/src/modules.ts`), and `vocabularyOwners` below derives that module's package from its
 * `migrations.from`; the root suite asserts no owner is generic. `packages/verifactu` — the AEAT
 * library, no descriptor of its own — is in no list at all, like `provisioning` and `tunnel`: not
 * generic, never scanned.
 */
```

- [ ] **Step 5: Refactor `english-only.ts` — shrink `SPANISH_WORDS` to the base list**

Replace the whole `SPANISH_WORDS` declaration — from the doc comment beginning `/**\n * Spanish vocabulary drawn from the spec, the findings and the naming` through the closing `]);` — with:

```ts
/**
 * The guard's BASE list: generic Spanish a generic package might reach for, owned by no module.
 * Every domain term lives on its module's `vocabulary` seat instead (`FISCAL_VOCABULARY` in
 * packages/fiscal-verifactu, `WORKFORCE_ES_VOCABULARY` in packages/workforce-es); the root suite
 * assembles the forbidden set with `forbiddenVocabulary` and asserts this list and the module
 * declarations are DISJOINT — a word has one declaring home, so a fiscal term added here is a
 * failing test, not a second copy. Add a term here only if no module owns it.
 *
 * Singular and plural are listed separately and nothing is stemmed — stemming `series` to `serie`
 * would fire on `invoice_series`, which is in the naming contract. Words identical in both languages
 * are deliberately absent: total, base, local/locale, error, real, id. All appear in the naming
 * contract, and a guard that fires on `sales.total` on day one is a guard that gets deleted on day
 * two. `nif` is absent for the same reason — an acronym for a legal identifier, not vocabulary.
 */
export const SPANISH_WORDS: ReadonlySet<string> = new Set([
  // POS vocabulary a generic package might reach for
  "venta",
  "ventas",
  "pedido",
  "pedidos",
  "linea",
  "lineas",
  "cantidad",
  "precio",
  "precios",
  "pago",
  "pagos",
  "cobro",
  "cobros",
  "mesa",
  "mesas",
  "caja",
  "cajas",
  "estado",
  "estados",
  "tipo",
  "tipos",
  "descripcion",
  "descripciones",
]);
```

- [ ] **Step 6: Refactor `english-only.ts` — `findSpanish` takes its word set; add the two helpers**

Change the `findSpanish` doc comment and signature from:

```ts
/** Every Spanish token in `source`, in order, with its line. */
export function findSpanish(source: string): Violation[] {
```
to
```ts
/**
 * Every token of `words` in `source`, in order, with its line. `words` is REQUIRED with no default,
 * so no caller can silently narrow to the base list: the root suite passes the assembled set
 * (`forbiddenVocabulary`), a package-local caller passes whatever it can legitimately know.
 */
export function findSpanish(source: string, words: ReadonlySet<string>): Violation[] {
```
and inside it change `if (SPANISH_WORDS.has(token)) {` to `if (words.has(token)) {`.

Then append at the end of the file:

```ts
/**
 * The two descriptor fields the guard reads. Structural on purpose: importing `WaitronModule` from
 * `@waitron/module` would give packages/db a dev-only dependency cycle (module → migrations → db).
 */
export interface VocabularyDeclaration {
  readonly name: string;
  readonly migrations: { readonly from: string };
  readonly vocabulary?: readonly string[];
}

export interface VocabularyOwner {
  /** The descriptor's name — the SLOT for a swappable module (`fiscal`), not the package. */
  readonly module: string;
  /** `packages/<packageDir>`, derived from `migrations.from`. */
  readonly packageDir: string;
  readonly terms: readonly string[];
}

/** `../<pkg>/drizzle` — the shape every descriptor's `migrations.from` has (module-graph-honesty
 * derives its package map from the same string). */
const MIGRATIONS_FROM = /^\.\.\/([^/]+)\/drizzle$/;

/**
 * Every module that declares a `vocabulary`, with its package dir derived from `migrations.from`.
 * A declaring module whose `from` has any other shape is refused loudly: the derivation would
 * otherwise exempt nothing and scan nothing, silently. An empty declaration is returned as an owner
 * with no terms so the suite can reject it by name.
 */
export function vocabularyOwners(modules: readonly VocabularyDeclaration[]): VocabularyOwner[] {
  const owners: VocabularyOwner[] = [];
  for (const module of modules) {
    if (module.vocabulary === undefined) continue;
    const match = MIGRATIONS_FROM.exec(module.migrations.from);
    if (match === null) {
      throw new Error(
        `english-only: module ${module.name} declares vocabulary but its migrations.from ` +
          `(${module.migrations.from}) is not ../<pkg>/drizzle`,
      );
    }
    owners.push({ module: module.name, packageDir: match[1]!, terms: module.vocabulary });
  }
  return owners;
}

/** The forbidden set: `base` ∪ every module's declared terms. Returns a new set; `base` is untouched. */
export function forbiddenVocabulary(
  base: ReadonlySet<string>,
  modules: readonly VocabularyDeclaration[],
): Set<string> {
  const words = new Set(base);
  for (const owner of vocabularyOwners(modules)) {
    for (const term of owner.terms) words.add(term);
  }
  return words;
}
```

Also update the `SELF` doc comment's first paragraph, which says `english-only.ts` "contains the entire Spanish wordlist in plain text": change `contains the entire Spanish wordlist in plain text` to `contains the guard's base wordlist in plain text`.

- [ ] **Step 7: Run the root suite and confirm it passes**

Run: `pnpm exec prettier --write scripts/english-only.test.ts packages/db/src/english-only.ts && pnpm vitest run scripts/english-only.test.ts`
Expected: PASS. If a generic-package file now fails, STOP — the union is wrong (a word was dropped or misspelt in Tasks 1–2); Step 8 will name it.

- [ ] **Step 8: Measure that the assembled set equals the recorded one (spec §7)**

Create `$SCRATCH/vocab-after.mts`:

```ts
import { readFileSync } from "node:fs";
const root = "/Users/clintongormley/workspace/worktrees/waitron-feat-module-sp3b-vocabulary";
const { SPANISH_WORDS } = await import(`${root}/packages/db/src/english-only.ts`);
const { FISCAL_VOCABULARY } = await import(`${root}/packages/fiscal-verifactu/src/vocabulary.ts`);
const { WORKFORCE_ES_VOCABULARY } = await import(`${root}/packages/workforce-es/src/vocabulary.ts`);
const after = [...new Set([...SPANISH_WORDS, ...FISCAL_VOCABULARY, ...WORKFORCE_ES_VOCABULARY])].sort();
const before: string[] = JSON.parse(readFileSync(process.argv[2]!, "utf8"));
const missing = before.filter((w) => !after.includes(w));
const added = after.filter((w) => !before.includes(w));
console.log({ before: before.length, after: after.length, missing, added });
if (missing.length > 0 || added.length > 0) process.exit(1);
console.log("assembled set equals the recorded set");
```

Run: `node --experimental-strip-types $SCRATCH/vocab-after.mts $SCRATCH/vocab-before.json 2>&1 | grep -v ExperimentalWarning`
Expected: `missing: [], added: []` and `assembled set equals the recorded set`, exit 0. Record the two counts in the commit message of Step 10 (they are a one-time receipt, not a pin).

- [ ] **Step 9: Prove the guards by deletion (spec §9), restoring after each**

Each line: make the edit, run `pnpm vitest run scripts/english-only.test.ts`, confirm the NAMED test fails, then `git checkout -- <file>` (or revert the edit by hand for an uncommitted file).

1. In `packages/fiscal-verifactu/src/vocabulary.ts` delete the line `"huella",` → expected red: `fiscal: fires on its owner's own source` (anchor `huella` missing). Restore.
2. Append `export const huella = 1;` to `packages/sync-enrolment/src/index.ts` → expected red: the `sync-enrolment: /sync-enrolment/src/index.ts` case, `1: huella — export const huella = 1;`. Restore.
3. Add `"fiscal-verifactu",` to `GENERIC_PACKAGES` in `english-only.ts` → expected red: `scopes itself to the twenty generic packages` AND `never scans a vocabulary owner's package`. Restore.
4. Add `"huella",` to `SPANISH_WORDS` in `english-only.ts` → expected red: `has one declaring home per word` with `huella (owned by fiscal)`. Restore.
5. In `packages/workforce-es/src/vocabulary.test.ts`, change `.filter(Boolean)` inside `tokenise` to `.filter((t) => t.length > 0)` → expected red: `workforce-es: its local copy is byte-identical to the guard's tokeniser`. Restore.

Step 8's measurement doubles as the arbiter of a disagreement between the two earlier task reviews (one counted today's `SPANISH_WORDS` at 135 words, the other at 142): report BOTH numbers it prints.

After restoring, run `git status --short` — only `packages/db/src/english-only.ts` and `scripts/english-only.test.ts` may be modified.

- [ ] **Step 10: The one in-package caller — `series.test.ts` retires its Spanish half and pins its columns**

`pnpm --filter @waitron/db typecheck` now fails with exactly one error, `Expected 2 arguments, but got 1` at the `findSpanish(n)` call in `packages/db/src/schema/series.test.ts`. That call exists to catch `cadena`/`secuencia`/`huella`/`registro` — fiscal's words, which `packages/db` can no longer know; that is the inversion working (spec §6).

In `packages/db/src/schema/series.test.ts` change
```ts
import { findSpanish } from "../english-only.js";
```
to
```ts
import { SPANISH_WORDS, findSpanish } from "../english-only.js";
```

and replace the whole `it("has no column relating a series to a chain", …)` block with:

```ts
  it("has no column relating a series to a chain, and exactly the columns it has today", async () => {
    // Findings §1: series is a numbering concern, the chain is a device concern. A column named for
    // chain position here would be the first step towards per-series chaining, which AEAT art. 7.c)
    // forbids outright.
    //
    // The chain terms are the regime-neutral English ones. Fiscal's own Spanish terms are fiscal's to
    // declare (its module's `vocabulary` seat), not this package's to know — the tree guard
    // (scripts/english-only.test.ts) catches a Spanish column NAME in this package's schema source
    // with the assembled set, and `SPANISH_WORDS` here is only the base list this package can
    // legitimately see. What the exact-column pin adds is the case neither reaches: a column added by
    // hand-written SQL in drizzle/, which no source scan sees. A new column is a deliberate edit here.
    const cols = await rows<{ column_name: string }>(
      db,
      sql`select column_name from information_schema.columns where table_name = 'invoice_series'`,
    );
    const names = cols.map((c) => c.column_name).sort();
    const offenders = names.filter(
      (n) => /chain|hash|previous|link|sequence/i.test(n) || findSpanish(n, SPANISH_WORDS).length > 0,
    );
    expect(offenders).toEqual([]);
    expect(names).toEqual(["code", "id", "next_number", "node_id", "purpose", "tenant_id"]);
  });
```

- [ ] **Step 11: Run that suite on both targets, and typecheck**

Run:
```bash
TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/db test series.test
pnpm --filter @waitron/db typecheck
```
Expected: PASS on the PGlite and the real-Postgres target; typecheck exit 0.

- [ ] **Step 12: Prove the column pin bites**

Temporarily change `"next_number"` in the expected array to `"next_num"`, re-run the same test command → expected FAIL showing the real column list. Restore.

- [ ] **Step 13: Coverage, lint, format; commit**

Run:
```bash
pnpm exec prettier --write packages/db/src/schema/series.test.ts
pnpm vitest run --coverage
pnpm --filter @waitron/db lint
pnpm lint
pnpm format:check
```
Expected: root coverage table shows `english-only.ts` at or above 98/98/98/95 (read the per-file row, not just the exit code — CLAUDE.md §4); everything else exits 0.

```bash
git add packages/db/src/english-only.ts scripts/english-only.test.ts packages/db/src/schema/series.test.ts
git commit -s -m "SP-3b: the english-only guard assembles its wordlist from the module descriptors

SPANISH_WORDS shrinks to the base list of generic Spanish no module owns;
findSpanish takes its word set (required); vocabularyOwners derives each
declaring module's package from migrations.from; forbiddenVocabulary unions.
EXEMPT_PACKAGES is deleted — an owner is exempt by derivation, and
packages/verifactu is an unlisted library. invoice_series' test pins its
column set instead of asking the base list about fiscal words. Measured
once: base ∪ fiscal ∪ workforce-es = the previous list, <N> words each
side, nothing missing or added."
```

(Replace `<N>` with the count Step 8 printed.)

---

### Task 4: Retire every receipt the move falsified; seat doc; CLAUDE.md §3

**Files:**
- Modify: `packages/module/src/module.ts:52` (seat doc)
- Modify: `packages/db/src/index.ts:132-143` (barrel comment names `EXEMPT_PACKAGES`; its closing sentence claims `vocabulary-scope.test.ts` reads this file's source text — false since Task 1)
- Modify: `vitest.config.ts:86-88` (the same false claim, inside the reason `english-only.ts` stays under the root `coverage.include`)
- Modify: `packages/db/src/english-only.ts:62,84` (two sentences still attribute the forbidden set to `SPANISH_WORDS`, which is now only the base list)
- Modify: `packages/db/vitest.config.ts:65` ("imports `findSpanish` alone" — `series.test.ts` now also imports `SPANISH_WORDS`)
- Modify: `packages/db/src/english-only.ts:31-38,77-78` (a `/** */` block attached to no declaration; a narrative paragraph in the `SELF` doc)
- Modify: `scripts/english-only.test.ts:9-10` (header wording: "the same derivation" overclaims)
- Modify: `packages/provisioning/src/fiscal-modules.ts:22-25`
- Modify: `packages/workforce/src/errors.ts:108`
- Modify: `packages/workforce/src/schema/absences.ts:17-18`
- Modify: `packages/workforce/src/schema/employments.ts:26-28`
- Modify: `packages/db/src/schema/sales.ts:133-134`
- Modify: `packages/db/src/schema/purchase-invoices.ts:28-29`
- Modify: `CLAUDE.md` §3 ("Spanish domain terms are deliberate" entry)
- Leave alone (they cite BASE words and stay true): `packages/layouts/src/device-profile.ts:49`, `packages/db/src/schema/sales.test.ts:259`, `packages/db/src/schema/park-retrieve.rls.test.ts:30`, `packages/db/src/schema/ticket-items.rls.test.ts:30`, `packages/db/src/schema/orders.transition.rls.test.ts:27,119`, `packages/db/src/provisioner-role.rls.test.ts:85`.

**Interfaces:** none (comments and docs only). A grep is the test.

- [ ] **Step 1: The seat's doc comment**

In `packages/module/src/module.ts`, replace the line
```ts
  readonly vocabulary?: readonly string[];
```
with
```ts
  /** SP-3b: the domain terms this module OWNS — legitimate inside its own package (derived from
   * `migrations.from`, `../<pkg>/drizzle`), forbidden in every generic package. Tokens, not words:
   * lowercase ASCII, unaccented, singular and plural separately, nothing stemmed. Read only by the
   * root english-only suite, which unions every declaration with the guard's base list and asserts
   * the two are disjoint; no runtime consumer. Omit the seat rather than declare `[]`. */
  readonly vocabulary?: readonly string[];
```

- [ ] **Step 2: The barrel comment in `packages/db/src/index.ts`**

Change the first line of that comment block
```ts
// english-only.ts's GENERIC_PACKAGES/EXEMPT_PACKAGES/findSpanish/sourceFilesIn are deliberately
```
to
```ts
// english-only.ts's GENERIC_PACKAGES/SPANISH_WORDS/findSpanish/vocabularyOwners are deliberately
```
Then read the rest of that block to its end (around line 143). The drizzle-kit `import.meta.dirname` reason stays — it is still true. Its closing sentence, which says `packages/fiscal-verifactu/src/vocabulary-scope.test.ts` reads this file's source text by relative path, is FALSE since Task 1: that test now reads only its own `schema/registros.ts` and `packages/fiscal`'s guard. Rewrite that sentence to:

```ts
// The package-local vocabulary tests (fiscal-verifactu, workforce-es) therefore carry their own
// copy of the tokeniser rather than importing this file.
```

- [ ] **Step 2b: The same false claim in the root `vitest.config.ts`**

In `vitest.config.ts`, inside the `coverage` comment, replace

```ts
      // whose suite is `scripts/english-only.test.ts`. The module stayed behind because two other
      // files in the tree reach for it where it is: `packages/db/src/schema/series.test.ts`
      // imports `findSpanish` from it, and `packages/fiscal-verifactu/src/vocabulary-scope.test.ts`
      // reads its source text by relative path. `packages/db`'s own config excludes it in the same
```

with

```ts
      // whose suite is `scripts/english-only.test.ts`. The module stayed behind because
      // `packages/db/src/schema/series.test.ts` imports `findSpanish` from it (the package-local
      // vocabulary tests carry their own copy of the tokeniser instead). `packages/db`'s own
      // config excludes it in the same
```

(the next line continues `// change, so it is measured in exactly one place …` unchanged; re-wrap only if a line exceeds 100 columns).

- [ ] **Step 2c: Three sentences that still call the forbidden set `SPANISH_WORDS`**

In `packages/db/src/english-only.ts` (inside the `apps/*` decision block, around line 62) replace
```ts
// says would end up listing most of `SPANISH_WORDS` below, which asserts nothing.
```
with
```ts
// says would end up listing most of the assembled forbidden set, which asserts nothing.
```

In the same file (the `SELF` doc comment, around line 84) replace
```ts
 * it is a SEPARATE guard, one this file's own `SPANISH_WORDS` cannot substitute for, because it
```
with
```ts
 * it is a SEPARATE guard, one this guard's forbidden set cannot substitute for, because it
```

In `packages/db/vitest.config.ts` (around line 65) replace
```ts
      // is src/schema/series.test.ts, which imports `findSpanish` alone.
```
with
```ts
      // is src/schema/series.test.ts, which imports `findSpanish` and the base `SPANISH_WORDS`.
```

- [ ] **Step 2d: Two more thins in `english-only.ts` and one in the suite header**

In `packages/db/src/english-only.ts`, the block that begins `/**\n * There is no exempt-package list.` (around lines 31–38) is a `/** … */` comment attached to no declaration, sitting above a `//` prose block that says of itself "belongs to no declaration". Convert it to the same `//` form, text unchanged:

```ts
// There is no exempt-package list. A package is Spanish by design exactly when a module DECLARES
// vocabulary (`WaitronModule.vocabulary`, the seat the composition root wires in
// `apps/server/src/modules.ts`), and `vocabularyOwners` below derives that module's package from its
// `migrations.from`; the root suite asserts no owner is generic. `packages/verifactu` — the AEAT
// library, no descriptor of its own — is in no list at all, like `provisioning` and `tunnel`: not
// generic, never scanned.
```

In the same file, the `SELF` doc comment's second paragraph is narrative and, since the wordlist here is now the base list, also wrong about what the suite's fixtures carry. Replace

```ts
 * `english-only.ts` contains the guard's base wordlist in plain text, so scanning it would fail
 * on the vocabulary it exists to define. Its suite carries the same wordlist in its fixtures and
 * was listed here for the same reason until 2026-08-01, when it moved to
 * `scripts/english-only.test.ts` — the repo-level Vitest project, so that a push touching neither
 * `packages/db` nor a package that depends on it still runs it. `sourceFilesIn` only ever walks
 * `packages/<name>/src`, so the suite is now out of scope by location and naming it here would be
 * an exemption matching nothing.
```

with

```ts
 * `english-only.ts` contains the guard's base wordlist in plain text, so scanning it would fail
 * on the vocabulary it exists to define. Its suite (`scripts/english-only.test.ts`, the repo-level
 * Vitest project) carries fiscal words in its fixtures but needs no entry here: `sourceFilesIn`
 * only ever walks `packages/<name>/src`, so the suite is out of scope by location.
```

In `scripts/english-only.test.ts`'s header, "the same derivation" overclaims — `module-graph-honesty.test.ts` reads the same `migrations.from` string with a slightly different regex (`(.+)` vs this file's `([^/]+)`). Replace

```ts
 * suite derives each owner's package dir from `migrations.from` (the same derivation
 * `module-graph-honesty.test.ts` uses), asserts no owner is a generic package, and proves each
```

with

```ts
 * suite derives each owner's package dir from `migrations.from` (the string
 * `module-graph-honesty.test.ts` reads too), asserts no owner is generic, and proves each
```

- [ ] **Step 3: `packages/provisioning/src/fiscal-modules.ts`**

Replace
```ts
 * This registry lives in @waitron/provisioning, not @waitron/fiscal, on purpose: the literals
 * "verifactu" and "iva" trip @waitron/fiscal's no-regime-vocabulary guard and english-only's
 * SPANISH_WORDS respectively. @waitron/provisioning is in neither GENERIC_PACKAGES nor
 * EXEMPT_PACKAGES, so the english-only scan never reaches it (see the plan's placement decision).
```
with
```ts
 * This registry lives in @waitron/provisioning, not @waitron/fiscal, on purpose: the literals
 * "verifactu" and "iva" trip @waitron/fiscal's no-regime-vocabulary guard and the english-only
 * guard respectively (`iva` is in the fiscal module's own vocabulary, packages/fiscal-verifactu).
 * @waitron/provisioning is not a generic package (english-only.ts's GENERIC_PACKAGES), so the scan
 * never reaches it.
```

- [ ] **Step 4: `packages/workforce/src/errors.ts`**

Replace
```ts
     * English `absence` term (the Spanish `ausencia` is in SPANISH_WORDS, so the code stays English
```
with
```ts
     * English `absence` term (the Spanish `ausencia` is workforce-es's declared vocabulary, so the
     * code stays English
```
(the following original line `     * like the schema, following the domain-concept convention). */` is unchanged).

- [ ] **Step 5: `packages/workforce/src/schema/absences.ts`**

Replace
```ts
 * The KIND of absence, in ENGLISH — this is a GENERIC package the english-only guard scans, and the
 * Spanish `vacaciones`/`baja`/`permiso` tokens are all in `SPANISH_WORDS`. The Spanish rendering of
```
with
```ts
 * The KIND of absence, in ENGLISH — this is a GENERIC package the english-only guard scans, and the
 * Spanish `vacaciones`/`baja`/`permiso` tokens are workforce-es's declared vocabulary. The Spanish
 * rendering of
```
(then re-wrap the rest of that paragraph so no line exceeds 100 columns; its wording is unchanged).

- [ ] **Step 6: `packages/workforce/src/schema/employments.ts`**

Replace
```ts
 * No `convenio_ref`: the 2026-08-02 plan §3 listed one, but `convenio` is a Spanish token in
 * `SPANISH_WORDS` (Slice 1) that the English-only guard forbids in this generic package, and it has
```
with
```ts
 * No `convenio_ref`: the 2026-08-02 plan §3 listed one, but `convenio` is workforce-es's declared
 * vocabulary, which the English-only guard forbids in this generic package, and it has
```

- [ ] **Step 7: `packages/db/src/schema/sales.ts`**

Replace
```ts
    // names, because `destinatario`/`destinatarios` are in SPANISH_WORDS (english-only.ts) and this
    // package is scanned; they mirror the module's `Counterparty` shape
```
with
```ts
    // names, because `destinatario`/`destinatarios` are the fiscal module's declared vocabulary and
    // this package is scanned by the english-only guard; they mirror the module's `Counterparty` shape
```

- [ ] **Step 8: `packages/db/src/schema/purchase-invoices.ts`**

Replace
```ts
 * named `tax` for the same reason `sales.vat_breakdown` and `VatRateLine` do — `cuota` is in
 * `SPANISH_WORDS`.
```
with
```ts
 * named `tax` for the same reason `sales.vat_breakdown` and `VatRateLine` do — `cuota` is the fiscal
 * module's declared vocabulary, forbidden here.
```

- [ ] **Step 9: CLAUDE.md §3**

Replace the entry
```markdown
- **Spanish domain terms are deliberate**, guarded by `packages/db/src/english-only.ts` (suite
  `scripts/english-only.test.ts`, root project). Fiscal tables and columns use the Veri\*Factu
  vocabulary (`envios`, `estado`, `huella`, `secuencia`, `entorno`); add new tokens to
  `SPANISH_WORDS`. `packages/verifactu` and `packages/fiscal-verifactu` are exempt; `apps/*` is out of
  scope by a recorded decision, so Spanish IDENTIFIERS in app UI code are caught only by review.
```
with
```markdown
- **Spanish domain terms are deliberate, and a module declares its own.** The guard is
  `packages/db/src/english-only.ts` (suite `scripts/english-only.test.ts`, root project); its
  `SPANISH_WORDS` is only the BASE list of generic POS Spanish no module owns. A module's terms live
  on its descriptor's `vocabulary` seat — `FISCAL_VOCABULARY` (`packages/fiscal-verifactu`),
  `WORKFORCE_ES_VOCABULARY` (`packages/workforce-es`), wired in `apps/server/src/modules.ts` — and
  the suite assembles the forbidden set from the descriptors, deriving each owner's package from
  `migrations.from`. One declaring home per word: a new fiscal term goes in the fiscal list, never
  the base (the suite fails on a clash). Fiscal tables and columns use the Veri\*Factu vocabulary
  (`envios`, `estado`, `huella`, `secuencia`, `entorno`). `packages/verifactu` is an unlisted
  library (in no list, never scanned); `apps/*` is out of scope by a recorded decision, so Spanish
  IDENTIFIERS in app UI code are caught only by review. Design:
  `docs/superpowers/specs/2026-09-05-module-sp3b-vocabulary-design.md`.
```

- [ ] **Step 10: Verify by grep and by gate**

Run:
```bash
grep -rn "EXEMPT_PACKAGES" packages apps scripts CLAUDE.md vitest.config.ts || echo "no EXEMPT_PACKAGES references remain"
grep -rn "SPANISH_WORDS" packages apps --include='*.ts' | grep -v "packages/db/src/english-only.ts"
grep -rn "reads its source text" packages apps scripts vitest.config.ts || echo "no source-text-read claims remain"
```
Expected: the first and third print their "no … remain" lines. The second's every remaining hit must cite a BASE word (`venta`, `mesa`, `linea`) or the file itself; read each line — any hit naming a fiscal or labour word is a receipt you missed. Then:

```bash
pnpm lint && pnpm typecheck && pnpm format:check
```
Expected: exit 0 (CLAUDE.md is format-checked; if prettier objects, `pnpm exec prettier --write CLAUDE.md`).

- [ ] **Step 11: Commit**

```bash
git add packages/module/src/module.ts packages/db/src/index.ts vitest.config.ts packages/db/src/english-only.ts packages/db/vitest.config.ts scripts/english-only.test.ts packages/provisioning/src/fiscal-modules.ts packages/workforce/src/errors.ts packages/workforce/src/schema/absences.ts packages/workforce/src/schema/employments.ts packages/db/src/schema/sales.ts packages/db/src/schema/purchase-invoices.ts CLAUDE.md
git commit -s -m "SP-3b: retire the receipts the vocabulary move falsified; seat doc; CLAUDE.md §3"
```

---

### Task 5: Polish from the Task 4 review, backlog row, the whole gate

**Files:**
- Modify: `CLAUDE.md` (§3 example list), `packages/module/src/module.ts` (seat doc wording), `packages/db/src/english-only.ts:31-36`, `packages/db/src/schema/purchase-invoices.ts:28-29`, `packages/db/src/schema/sales.ts:133-136`, `packages/workforce/src/errors.ts:108-110`, `vitest.config.ts:86-89` — comment wording and line-width tidy-ups on lines THIS branch added (never touch a pre-existing over-long line)
- Modify: `docs/backlog.md` (the SP-3b bullet under *Waitron module system*, and the Track C item 1 line)

- [ ] **Step 0: Seven one-line polishes (all comments; no behaviour)**

1. `CLAUDE.md`, the §3 entry: `estado` is a BASE word, not fiscal's, and the sentence sits two lines after "a new fiscal term goes in the fiscal list". Replace the substring
   ```
   (`envios`, `estado`, `huella`, `secuencia`, `entorno`)
   ```
   with
   ```
   (`envios`, `huella`, `secuencia`, `entorno`)
   ```
2. `packages/module/src/module.ts`, the `vocabulary` seat's doc comment (added on this branch): `apps/server/src/modules.test.ts` also reads the seat, so "read only by" overclaims. Replace
   ```ts
   * lowercase ASCII, unaccented, singular and plural separately, nothing stemmed. Read only by the
   * root english-only suite, which unions every declaration with the guard's base list and asserts
   * the two are disjoint; no runtime consumer. Omit the seat rather than declare `[]`. */
   ```
   with
   ```ts
   * lowercase ASCII, unaccented, singular and plural separately, nothing stemmed. Interpreted only
   * by the root english-only suite, which unions every declaration with the guard's base list and
   * asserts the two are disjoint; no runtime consumer. Omit the seat rather than declare `[]`. */
   ```
3. `packages/db/src/english-only.ts:31-36` (the `//` block this branch added; line 33 is 101 columns). Replace the six lines with
   ```ts
   // There is no exempt-package list. A package is Spanish by design exactly when a module DECLARES
   // vocabulary (`WaitronModule.vocabulary`, the seat the composition root wires in
   // `apps/server/src/modules.ts`), and `vocabularyOwners` below derives that module's package from
   // its `migrations.from`; the root suite asserts no owner is generic. `packages/verifactu` — the
   // AEAT library, no descriptor of its own — is in no list at all, like `provisioning` and `tunnel`:
   // not generic, never scanned.
   ```
4. `packages/db/src/schema/purchase-invoices.ts:28-29`. Replace
   ```ts
    * named `tax` for the same reason `sales.vat_breakdown` and `VatRateLine` do — `cuota` is the fiscal
    * module's declared vocabulary, forbidden here.
   ```
   with
   ```ts
    * named `tax` for the same reason `sales.vat_breakdown` and `VatRateLine` do — `cuota` is the
    * fiscal module's declared vocabulary, forbidden here.
   ```
5. `packages/db/src/schema/sales.ts:133-136`. Replace
   ```ts
       // names, because `destinatario`/`destinatarios` are the fiscal module's declared vocabulary and
       // this package is scanned by the english-only guard; they mirror the module's `Counterparty` shape
       // (packages/fiscal/src/backend.ts). All NULLABLE with no backfill (pre-production, no deployed
       // data), and immutable table-wide like every other column here.
   ```
   with
   ```ts
       // names, because `destinatario`/`destinatarios` are the fiscal module's declared vocabulary
       // and this package is scanned by the english-only guard; they mirror the module's
       // `Counterparty` shape (packages/fiscal/src/backend.ts). All NULLABLE with no backfill
       // (pre-production, no deployed data), and immutable table-wide like every other column here.
   ```
6. `packages/workforce/src/errors.ts:108-110`. Replace
   ```ts
        * English `absence` term (the Spanish `ausencia` is workforce-es's declared vocabulary, so the
        * code stays English
        * like the schema, following the domain-concept convention). */
   ```
   with
   ```ts
        * English `absence` term (the Spanish `ausencia` is workforce-es's declared vocabulary, so the
        * code stays English like the schema, following the domain-concept convention). */
   ```
7. `vitest.config.ts:86-89`. Replace
   ```ts
         // vocabulary tests carry their own copy of the tokeniser instead). `packages/db`'s own
         // config excludes it in the same
         // change, so it is measured in exactly one place rather than in two or in none — the failure
         // mode being the last of those, which no threshold anywhere would report.
   ```
   with
   ```ts
         // vocabulary tests carry their own copy of the tokeniser instead). `packages/db`'s own
         // config excludes it in the same change, so it is measured in exactly one place rather than
         // in two or in none — the failure mode being the last of those, which no threshold anywhere
         // would report.
   ```

Then `awk 'length($0) > 100 { print FILENAME ":" FNR ": " length($0) }' <each of the seven files>` must print nothing for a line this branch added (pre-existing over-long lines elsewhere in those files are not yours — compare against `git diff 624fa5a0..HEAD -- <file>` if unsure). Then:

```bash
pnpm exec prettier --write CLAUDE.md vitest.config.ts packages/module/src/module.ts packages/db/src/english-only.ts packages/db/src/schema/purchase-invoices.ts packages/db/src/schema/sales.ts packages/workforce/src/errors.ts
pnpm format:check
git add CLAUDE.md vitest.config.ts packages/module/src/module.ts packages/db/src/english-only.ts packages/db/src/schema/purchase-invoices.ts packages/db/src/schema/sales.ts packages/workforce/src/errors.ts
git commit -s -m "SP-3b: review polish — CLAUDE.md example list, seat doc wording, comment wraps"
```

- [ ] **Step 1: Backlog — SP-3b in flight**

In `docs/backlog.md`, replace the bullet beginning `  - **SP-3b — module-owned vocabulary (NEXT candidate).**` (three lines) with:

```markdown
  - **SP-3b — module-owned vocabulary — IN FLIGHT (spec + plan on `feat/module-sp3b-vocabulary`).**
    Fiscal's and workforce-es's Spanish terms move out of the centralized `packages/db/src/english-only.ts`
    into `FISCAL_VOCABULARY` / `WORKFORCE_ES_VOCABULARY`, declared on each descriptor's `vocabulary` seat;
    the root suite assembles the forbidden set, derives each owner's package from `migrations.from`, and
    asserts base ∩ modules = ∅. `EXEMPT_PACKAGES` deleted; `GENERIC_PACKAGES` stays explicit (measured:
    a scan-everything flip would hit `provisioning` 155 times — a separate decision). No runtime change.
    Spec: [sp-3b](superpowers/specs/2026-09-05-module-sp3b-vocabulary-design.md); plan:
    [sp-3b plan](superpowers/plans/2026-09-05-module-sp3b-vocabulary.md).
```

In the Track C list (item 1, `**Finish fiscal as a module:** SP-3b vocabulary, SP-3c …`), change `SP-3b vocabulary` to `SP-3b vocabulary (in flight)`.

- [ ] **Step 2: The gate, package by package (never two browser-mode runs; nothing else running)**

Confirm `pgrep -f .husky/pre-push` prints nothing and no other test run is active, then:

```bash
pnpm lint && pnpm typecheck && pnpm format:check
pnpm vitest run --coverage
TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/db test:coverage
TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/fiscal-verifactu test:coverage
pnpm --filter @waitron/workforce-es test:coverage
pnpm --filter @waitron/module test:coverage
pnpm --filter @waitron/workforce test:coverage
pnpm --filter @waitron/provisioning test:coverage
pnpm --filter @waitron/layouts test:coverage
pnpm --filter @waitron/server test modules.test
pnpm --filter @waitron/fiscal-verifactu test inmutabilidad
```
Expected: every command exits 0 and every coverage run stays above its thresholds (read the tables). `apps/server`'s full real-PG shard is left to the pre-push hook and CI: this slice changes two descriptor fields there and nothing else. If `pnpm --filter @waitron/db test:coverage` leaks containers on an interruption, `pnpm reap` before retrying.

- [ ] **Step 3: Commit**

```bash
git add docs/backlog.md
git commit -s -m "docs(backlog): SP-3b module-owned vocabulary in flight"
```

Then hand the branch to `/finish-branch` (simplify → run-it reviewer + convention reviewer → rebase → PR → CI + Copilot).
