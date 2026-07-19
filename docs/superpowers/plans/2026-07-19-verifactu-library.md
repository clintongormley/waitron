# Veri\*Factu Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `packages/verifactu` — a standalone, publishable TypeScript library that constructs, hashes, chains, validates, serialises and submits Spanish Veri\*Factu invoicing records, verified against AEAT's own test vectors.

**Architecture:** Pure and stateless. Every export is a function over plain data — no database, no persistence, no ambient state, no I/O except through an injected `fetch`. The caller owns storage and ordering. Zero dependencies on any other package in this repo, enforced by an existing ESLint rule.

**Tech Stack:** TypeScript 5.7+, Vitest 3 (Node environment — no browser), Stryker for mutation testing, Node's built-in `node:crypto` for SHA-256. Exactly one runtime dependency: `fast-xml-parser` (MIT), for parsing AEAT responses. Serialisation is hand-rolled, so nothing else is needed.

**Source spec:** [`2026-07-19-sales-spine-and-fiscal-layer-design.md`](../specs/2026-07-19-sales-spine-and-fiscal-layer-design.md) §1, §5, §10.

**Scope note:** This is plan 1 of 2. It builds the library only. The sales spine — `packages/db`, `packages/core`, `packages/fiscal`, `packages/fiscal-verifactu` — is plan 2 and consumes what this produces.

---

## Global Constraints

Every task's requirements implicitly include this section.

- **Node 26** (`.nvmrc`), **pnpm 9.15.0**. Package name `@waitron/verifactu`.
- **Zero in-repo dependencies.** `packages/verifactu` must never import from any other `packages/*` or `apps/*`. Enforced by the `import-x/no-restricted-paths` zone already present in `eslint.config.js`. If a task seems to need one, that is a design question to raise, not a lint rule to loosen.
- **External npm dependencies are permitted but kept minimal.** The boundary rule restricts _in-repo_ imports only — a sibling `node_modules` dependency is explicitly unaffected. Every runtime dependency is nonetheless audited surface inside a fiscal library, so add one only where hand-rolling is worse. Hashing uses `node:crypto` (no dependency). XML **parsing** uses `fast-xml-parser` (MIT), because a hand-rolled parser for AEAT's responses is a liability. XML **serialisation** is hand-rolled, because emitting a fixed, known structure is straightforward and keeps full control of the literals.
- **Provenance:** implement from AEAT's published specification only. **Never read `mdiago/VeriFactu` source** — it is AGPL-3.0 and a port would be a derivative work. Running its binary to generate comparison vectors is permitted; opening its source is not. See [`implementation-provenance.md`](../../compliance/implementation-provenance.md).
- **Naming: Spanish nouns, English verbs.** Types mirror AEAT exactly (`RegistroAlta`, `Encadenamiento`, `DetalleDesglose`); functions are English (`buildAltaRecord`, `computeHuella`).
- **Serialise once, hash that exact literal.** Never reformat a value between serialising it and hashing it. Records carry pre-formatted string literals for all amounts and timestamps.
- **Per-test red phase.** Observe every new test failing **individually** before writing its implementation. A test that passes before its feature exists is a defect in the test. Run the single test by name, not the file.
- **Mutation score ≥ 90%**, enforced by `thresholds.break` in `stryker.config.json`.
- **Never hardcode the AEAT timestamp margin.** The threshold is deliberately unpublished; breaching it is a warning that never rejects. No test may assert 240 seconds or any other value.
- **Prettier**: `printWidth: 100`, `trailingComma: "all"`. **TypeScript**: `strict`, `noUnusedLocals`, `noUnusedParameters`, `verbatimModuleSyntax`, `isolatedModules`.

### Serialisation policy (spec §5)

Six spec ambiguities, each settled by choosing the reading valid under every interpretation:

| Rule | Policy |
| --- | --- |
| Trim | Strip `[\x00-\x20]` only — **not** JS `.trim()`, which also strips NBSP and U+FEFF |
| Amount decimals | Always exactly **2** |
| Amount sign | Never emit `+`; emit `-` only for genuinely negative values |
| Timestamp zone | Always `±hh:mm`, never `Z` |
| Timestamp seconds | Whole seconds only, never fractional |
| QR encoding | Restrict `NumSerieFactura` charset so form-urlencoding and RFC 3986 coincide |

---

## File Structure

```text
packages/verifactu/
  package.json                    scripts; one runtime dep (fast-xml-parser)
  tsconfig.json                   extends ../../tsconfig.base.json
  vitest.config.ts                node environment, coverage thresholds
  stryker.config.json             mutation, thresholds.break 90
  PROVENANCE.md                   which AEAT docs, which references, mdiago unread
  README.md                       usage + "a tool for building SIFs, not a SIF"
  src/
    index.ts                      the entire public surface, re-exports only
    types.ts                      RegistroAlta, RegistroAnulacion, Encadenamiento,
                                  DetalleDesglose, SistemaInformatico, IDFactura, inputs
    format.ts                     trimValue, formatAmount, formatDateTime, formatDate
    huella.ts                     buildCadena{Alta,Anulacion}, computeHuella, verifyHuella
    records.ts                    buildAltaRecord, buildAnulacionRecord
    validate.ts                   validate() — pre-flight against AEAT validation rules
    qr.ts                         buildQrPayload
    xml/
      serialize.ts                serializeEnvio, serializeConsulta
      parse-suministro.ts         parseRespuestaSuministro (+ RegistroDuplicado)
      parse-consulta.ts           parseRespuestaConsulta (separate enum, no CSV)
      escape.ts                   XML text escaping
    client.ts                     createClient({ cert, key, endpoint, fetch })
    endpoints.ts                  production and preproduction URLs
  test/
    vectors.ts                    AEAT's three official huella vectors, verbatim
```

Files are split by responsibility rather than layer, and kept small enough to hold in context whole. `huella.ts` is deliberately separate from `records.ts`: hashing is the part that must be provably correct against AEAT's vectors, and it should be readable without the record-construction noise around it.

---

## Task 1: Scaffold the package and wire the toolchain

Infrastructure task. Its deliverable is a package whose test, typecheck, lint and mutation commands all run, and whose boundary rule is observed firing.

**Files:**

- Create: `packages/verifactu/package.json`
- Create: `packages/verifactu/tsconfig.json`
- Create: `packages/verifactu/vitest.config.ts`
- Create: `packages/verifactu/stryker.config.json`
- Create: `packages/verifactu/src/index.ts`
- Create: `packages/verifactu/PROVENANCE.md`
- Modify: `.husky/pre-push`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**

- Consumes: nothing.
- Produces: a working `@waitron/verifactu` package; `pnpm --filter @waitron/verifactu {test,typecheck,mutation}`.

- [ ] **Step 1: Create the package manifest**

`packages/verifactu/package.json`:

```json
{
  "name": "@waitron/verifactu",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "typecheck": "tsc --noEmit",
    "lint": "eslint .",
    "mutation": "stryker run"
  },
  "dependencies": {
    "fast-xml-parser": "^4.5.0"
  },
  "devDependencies": {
    "@stryker-mutator/core": "^9.6.1",
    "@stryker-mutator/vitest-runner": "^9.6.1",
    "@vitest/coverage-v8": "^3.0.0",
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  }
}
```

`fast-xml-parser` is the only runtime dependency, and it is used for parsing
AEAT responses only. No `@waitron/*` dependency may ever appear here — that is
what the ESLint boundary enforces, and Step 7 verifies it fires.

- [ ] **Step 2: Create the TypeScript config**

`packages/verifactu/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "types": ["vitest/globals"]
  },
  "include": ["src", "test"]
}
```

- [ ] **Step 3: Create the Vitest config**

`packages/verifactu/vitest.config.ts`. Note this is a **Node** environment — unlike `packages/ui`, there is no browser, no Playwright and no Chromium. That is what makes per-PR mutation testing affordable here.

```ts
import { coverageConfigDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      exclude: [...coverageConfigDefaults.exclude, "test/vectors.ts"],
      // Higher floors than packages/ui: this is pure functions over plain data
      // with no rendering, no async and no DOM, so there is no legitimate
      // reason for a branch here to go unexercised.
      thresholds: {
        statements: 98,
        lines: 98,
        functions: 98,
        branches: 95,
      },
    },
  },
});
```

- [ ] **Step 4: Create the Stryker config**

`packages/verifactu/stryker.config.json`. Unlike `packages/ui`, this one **breaks the build** below 90.

```json
{
  "$schema": "../../node_modules/@stryker-mutator/core/schema/stryker-schema.json",
  "packageManager": "pnpm",
  "plugins": ["@stryker-mutator/vitest-runner"],
  "testRunner": "vitest",
  "vitest": { "configFile": "vitest.config.ts" },
  "mutate": ["src/**/*.ts", "!src/**/*.test.ts"],
  "incremental": true,
  "incrementalFile": "reports/stryker-incremental.json",
  "reporters": ["clear-text", "progress", "html"],
  "htmlReporter": { "fileName": "reports/mutation/index.html" },
  "coverageAnalysis": "perTest",
  "thresholds": { "high": 95, "low": 90, "break": 90 }
}
```

- [ ] **Step 5: Create the empty public surface**

`packages/verifactu/src/index.ts`:

```ts
// The entire public surface of @waitron/verifactu. Re-exports only — no logic here.
export {};
```

- [ ] **Step 6: Install and verify the toolchain runs**

```bash
pnpm install
pnpm --filter @waitron/verifactu typecheck
```

Expected: typecheck passes with no output.

```bash
pnpm --filter @waitron/verifactu test
```

Expected: Vitest reports "No test files found" and exits non-zero. That is correct at this point — there are no tests yet.

- [ ] **Step 7: Observe the boundary rule actually firing**

This is a teeth check on a rule written before the package existed. Do not skip it — a boundary rule that does not fire is worse than none, because it produces false confidence.

Create `packages/verifactu/src/boundary-probe.ts`:

```ts
import { WtButton } from "@waitron/ui";
export const probe = WtButton;
```

Run:

```bash
pnpm lint
```

Expected: FAIL, with the message "packages/verifactu is a standalone, publishable library and must have zero dependencies on any other package in this repo".

Now delete the probe:

```bash
rm packages/verifactu/src/boundary-probe.ts
pnpm lint
```

Expected: PASS, no output.

- [ ] **Step 8: Fix the pre-push hook, which currently would not cover this package**

`.husky/pre-push` hardcodes `--filter @waitron/ui`, so without this change the new package's tests never run pre-push and the hook would pass while the fiscal library is broken.

Replace these two lines:

```sh
run_step "typecheck" "pnpm --filter @waitron/ui typecheck"
run_step "tests" "pnpm --filter @waitron/ui test"
```

with:

```sh
run_step "typecheck" "pnpm typecheck"
run_step "tests" "pnpm test"
```

Both root scripts are already recursive (`pnpm -r typecheck`, `pnpm -r test`), so this picks up every current and future package automatically.

- [ ] **Step 9: Add the mutation gate to CI**

In `.github/workflows/ci.yml`, add a fourth job. Keep the existing three untouched — their job ids are a stable interface the ruleset depends on by name.

```yaml
  # Mutation testing for packages/verifactu only. Unlike packages/ui — whose
  # mutation run is weekly in mutation.yml because each mutant reruns the full
  # real-Chromium suite — this package is pure Node with no browser, so a run
  # is cheap enough to gate every PR. It is also the package where a hollow
  # test means an unverifiable hash chain rather than a misaligned button,
  # which is why it carries a hard threshold (break: 90) while packages/ui
  # publishes a score without failing on it.
  mutation-verifactu:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5

      - uses: pnpm/action-setup@v6
        with:
          version: 9.15.0

      - uses: actions/setup-node@v5
        with:
          node-version-file: ".nvmrc"
          cache: pnpm

      - run: pnpm install --frozen-lockfile

      - run: pnpm --filter @waitron/verifactu mutation
```

> **Requires a ruleset change you must make manually.** Adding the job does not make it required. To gate merges on it, add `mutation-verifactu` to the required status checks of ruleset `19157474`. Until then it runs and reports but does not block.

- [ ] **Step 10: Write the provenance record**

`packages/verifactu/PROVENANCE.md`:

```markdown
# Provenance

This library implements Spain's Veri\*Factu specification (RD 1007/2023, Orden HAC/1177/2024)
from AEAT's published technical documentation. Two independent implementations of a published
government specification are not derivative of each other.

## Implemented from

| Document | Version |
| --- | --- |
| AEAT, especificaciones técnicas huella/hash de los registros de facturación | 0.1.2, 27/08/2024 |
| AEAT, especificaciones técnicas del código QR y URL de cotejo | 0.5.0 |
| AEAT, Descripción del servicio web | 1.0.3 |
| AEAT, Validaciones y errores | 1.2.2 |
| AEAT, FAQs Desarrolladores | 04/12/2025 |
| AEAT XSDs: SuministroInformacion, SuministroLR, RespuestaSuministro, ConsultaLR, RespuestaConsultaLR | v1.0 |
| AEAT `SistemaFacturacion.wsdl` | — |
| Orden HAC/1177/2024 (BOE-A-2024-22138), arts. 7, 13, 16 | consolidated |

## References consulted

- `borjamrd/verifactu-conformance` (MIT) — official AEAT test vectors packaged for CI.
- `inoguerols/verifactu` (MIT) — consulted as a reference implementation.

## Not consulted

`mdiago/VeriFactu` is AGPL-3.0. **Its source was not read.** It may be used only as a black-box
differential oracle — executing the binary and comparing output is comparing behaviour, not
copying expression.

## Disclaimer

This library is a tool for building SIFs. **It is not itself a SIF.** A *sistema informático de
facturación* is a deployed system, and its obligations — conservation, inalterability,
accessibility of records — are properties of a deployment, not of source code. Each deploying
business issues its own declaración responsable for its own installation.
```

- [ ] **Step 11: Commit**

```bash
git add packages/verifactu .husky/pre-push .github/workflows/ci.yml pnpm-lock.yaml
git commit -m "feat(verifactu): scaffold the standalone library package

Node-environment Vitest (no browser), Stryker with a hard 90% break
threshold, and a CI job that can gate on it — affordable here precisely
because this package has no Chromium suite behind each mutant.

The boundary rule written before this package existed was observed firing
against a probe import and then passing once removed.

Also fixes .husky/pre-push, which hardcoded --filter @waitron/ui and would
therefore have passed while this package was broken."
```

---

## Task 2: Field formatting — the serialisation policy in code

Every huella depends on these three functions producing exactly the right literal. They are the smallest, most-tested, highest-consequence code in the library.

**Files:**

- Create: `packages/verifactu/src/format.ts`
- Create: `packages/verifactu/src/format.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces:
  - `trimValue(value: string | undefined | null): string`
  - `formatAmount(value: number): string`
  - `formatDate(date: Date, offsetMinutes: number): string` → `DD-MM-YYYY`
  - `formatDateTime(date: Date, offsetMinutes: number): string` → `YYYY-MM-DDThh:mm:ss±hh:mm`

- [ ] **Step 1: Write the failing tests**

`packages/verifactu/src/format.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { formatAmount, formatDate, formatDateTime, trimValue } from "./format.js";

describe("trimValue", () => {
  it("strips leading and trailing ASCII whitespace", () => {
    expect(trimValue("  12345678 / G33  ")).toBe("12345678 / G33");
  });

  it("preserves interior whitespace verbatim", () => {
    // AEAT's own example keeps the spaces around the slash.
    expect(trimValue(" 12345678 / G33 ")).toBe("12345678 / G33");
  });

  it("strips tab, newline and carriage return", () => {
    expect(trimValue("\t\r\nABC\n\r\t")).toBe("ABC");
  });

  it("does NOT strip a non-breaking space", () => {
    // Policy: match AEAT's reference trim (code points <= U+0020) rather than
    // JS .trim(), which also strips U+00A0 and U+FEFF. Using .trim() here would
    // produce a different huella from AEAT's recomputation.
    expect(trimValue(" ABC ")).toBe(" ABC ");
  });

  it("does NOT strip a zero-width no-break space", () => {
    expect(trimValue("﻿ABC﻿")).toBe("﻿ABC﻿");
  });

  it("maps null and undefined to the empty string", () => {
    expect(trimValue(null)).toBe("");
    expect(trimValue(undefined)).toBe("");
  });
});

describe("formatAmount", () => {
  it("always emits exactly two decimal places", () => {
    expect(formatAmount(123)).toBe("123.00");
    expect(formatAmount(123.1)).toBe("123.10");
    expect(formatAmount(123.45)).toBe("123.45");
  });

  it("never emits a leading plus", () => {
    expect(formatAmount(123.45)).not.toContain("+");
  });

  it("emits a minus for negative amounts", () => {
    expect(formatAmount(-123.45)).toBe("-123.45");
  });

  it("emits zero without a sign", () => {
    expect(formatAmount(0)).toBe("0.00");
    expect(formatAmount(-0)).toBe("0.00");
  });

  it("rounds half away from zero", () => {
    // Currency rounding, not JS Math.round's half-up-toward-positive-infinity,
    // which would round -0.125 to -0.12 and break symmetry with +0.125.
    expect(formatAmount(0.125)).toBe("0.13");
    expect(formatAmount(-0.125)).toBe("-0.13");
  });

  it("rejects a non-finite amount", () => {
    expect(() => formatAmount(Number.NaN)).toThrow(/finite/i);
    expect(() => formatAmount(Number.POSITIVE_INFINITY)).toThrow(/finite/i);
  });

  it("rejects an amount beyond the 12-integer-digit schema limit", () => {
    expect(() => formatAmount(1_000_000_000_000)).toThrow(/12/);
  });
});

describe("formatDate", () => {
  it("emits DD-MM-YYYY, zero padded", () => {
    expect(formatDate(new Date("2024-01-01T19:20:30+01:00"), 60)).toBe("01-01-2024");
  });

  it("uses the supplied offset, not the host timezone", () => {
    // 00:30 on the 2nd at +02:00 is still 22:30 on the 1st in UTC. The date
    // must follow the offset we were given, or an invoice issued just after
    // midnight gets yesterday's date.
    expect(formatDate(new Date("2024-03-01T22:30:00Z"), 120)).toBe("02-03-2024");
  });
});

describe("formatDateTime", () => {
  it("emits YYYY-MM-DDThh:mm:ss with a numeric offset", () => {
    expect(formatDateTime(new Date("2024-01-01T19:20:30+01:00"), 60)).toBe(
      "2024-01-01T19:20:30+01:00",
    );
  });

  it("emits +00:00 rather than Z", () => {
    // Policy: xs:dateTime permits Z, but no AEAT example uses it and the hash
    // is over the literal, so the form must be fixed once.
    expect(formatDateTime(new Date("2024-01-01T19:20:30Z"), 0)).toBe("2024-01-01T19:20:30+00:00");
  });

  it("emits a negative offset correctly", () => {
    expect(formatDateTime(new Date("2024-01-01T19:20:30Z"), -210)).toBe(
      "2024-01-01T15:50:30-03:30",
    );
  });

  it("truncates fractional seconds", () => {
    expect(formatDateTime(new Date("2024-01-01T19:20:30.789Z"), 0)).toBe("2024-01-01T19:20:30+00:00");
  });

  it("rejects an invalid date", () => {
    expect(() => formatDateTime(new Date("nonsense"), 0)).toThrow(/invalid/i);
  });
});
```

- [ ] **Step 2: Run each test individually and watch it fail**

The Global Constraint requires per-test red observation, not per-file. Run them one at a time:

```bash
cd packages/verifactu
pnpm vitest run -t "strips leading and trailing ASCII whitespace"
```

Expected: FAIL — `Failed to resolve import "./format.js"`.

Repeat for every test name above, confirming each fails on its own. A test that passes here is a defect in the test, not a head start.

- [ ] **Step 3: Implement**

`packages/verifactu/src/format.ts`:

```ts
/**
 * Value formatting for Veri*Factu records.
 *
 * The huella is SHA-256 over a string built from these literals, and AEAT
 * recomputes from the literal it received — so `123.1` and `123.10` are both
 * valid and hash differently. Every value is therefore formatted exactly once,
 * here, and the same literal goes into both the XML and the hash.
 */

const MAX_INTEGER_DIGITS = 12;

/**
 * Strips leading/trailing whitespace using AEAT's reference semantics: code
 * points <= U+0020 only.
 *
 * Deliberately NOT String.prototype.trim(), which also strips U+00A0 and
 * U+FEFF. AEAT recomputes the huella with the narrower rule, so using the
 * wider one would produce a mismatching hash for any value carrying a
 * non-breaking space. Interior whitespace is preserved verbatim.
 */
export function trimValue(value: string | undefined | null): string {
  if (value === undefined || value === null) return "";
  let start = 0;
  let end = value.length;
  while (start < end && value.charCodeAt(start) <= 0x20) start += 1;
  while (end > start && value.charCodeAt(end - 1) <= 0x20) end -= 1;
  return value.slice(start, end);
}

/**
 * Formats a monetary amount as the record literal: always two decimal places,
 * `.` separator, never a leading `+`, rounded half away from zero.
 */
export function formatAmount(value: number): string {
  if (!Number.isFinite(value)) {
    throw new Error(`Amount must be finite, received ${String(value)}`);
  }
  const scaled = Math.round(Math.abs(value) * 100 + Number.EPSILON);
  const integerPart = Math.floor(scaled / 100);
  if (String(integerPart).length > MAX_INTEGER_DIGITS) {
    throw new Error(
      `Amount exceeds the ${MAX_INTEGER_DIGITS} integer digits permitted by ImporteSgn12.2Type`,
    );
  }
  const sign = value < 0 && scaled !== 0 ? "-" : "";
  return `${sign}${integerPart}.${String(scaled % 100).padStart(2, "0")}`;
}

/** Shifts a Date by an offset so its UTC accessors read as local-at-that-offset. */
function shift(date: Date, offsetMinutes: number): Date {
  if (Number.isNaN(date.getTime())) {
    throw new Error("Invalid date supplied");
  }
  return new Date(date.getTime() + offsetMinutes * 60_000);
}

function pad(value: number, width = 2): string {
  return String(value).padStart(width, "0");
}

/** Formats the date part as `DD-MM-YYYY` — AEAT's `sf:fecha`, not ISO 8601. */
export function formatDate(date: Date, offsetMinutes: number): string {
  const d = shift(date, offsetMinutes);
  return `${pad(d.getUTCDate())}-${pad(d.getUTCMonth() + 1)}-${d.getUTCFullYear()}`;
}

/**
 * Formats `FechaHoraHusoGenRegistro` as `YYYY-MM-DDThh:mm:ss±hh:mm`.
 *
 * Always a numeric offset, never `Z`; always whole seconds. Both are policy
 * choices — the schema permits the alternatives, no AEAT example uses them,
 * and the hash is over the literal, so the form must be fixed once.
 */
export function formatDateTime(date: Date, offsetMinutes: number): string {
  const d = shift(date, offsetMinutes);
  const sign = offsetMinutes < 0 ? "-" : "+";
  const abs = Math.abs(offsetMinutes);
  const datePart = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  const timePart = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
  return `${datePart}T${timePart}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}
```

- [ ] **Step 4: Run the tests and verify they pass**

```bash
pnpm vitest run src/format.test.ts
```

Expected: PASS, 20 tests.

- [ ] **Step 5: Verify the mutation score for this file**

```bash
pnpm mutation
```

Expected: no surviving mutants in `format.ts`. If one survives on the `<= 0x20` comparison or the sign condition, a test is missing — add it rather than lowering the threshold.

- [ ] **Step 6: Commit**

```bash
git add packages/verifactu/src/format.ts packages/verifactu/src/format.test.ts
git commit -m "feat(verifactu): value formatting per the serialisation policy

Trim uses AEAT's reference semantics (code points <= U+0020), deliberately
not String.prototype.trim() — the wider Unicode rule would strip a
non-breaking space that AEAT keeps, producing a mismatching huella.

Amounts always carry two decimals and never a leading plus; timestamps
always a numeric offset and whole seconds. The schema permits the
alternatives, so the form has to be fixed once and applied everywhere."
```

---

## Task 3: The huella — canonical string, hash, and AEAT's three official vectors

The heart of the library. AEAT publishes three worked examples that form a **chain** (alta → chained alta → anulación), so they exercise chaining rather than three isolated hashes. Wire them in before writing anything else, per the reference's own advice.

**Files:**

- Create: `packages/verifactu/src/types.ts`
- Create: `packages/verifactu/src/huella.ts`
- Create: `packages/verifactu/src/huella.test.ts`
- Create: `packages/verifactu/test/vectors.ts`

**Interfaces:**

- Consumes: `trimValue` from `./format.js`.
- Produces:
  - `buildCadenaAlta(input: CadenaAltaInput): string`
  - `buildCadenaAnulacion(input: CadenaAnulacionInput): string`
  - `computeHuella(record: RegistroAlta | RegistroAnulacion): string`
  - `verifyHuella(record: RegistroAlta | RegistroAnulacion): boolean`
  - `huellaAnteriorOf(encadenamiento: Encadenamiento): string`
  - Types: `RegistroAlta`, `RegistroAnulacion`, `Encadenamiento`, `RegistroAnterior`, `IDFactura`, `IDFacturaAnulada`, `SistemaInformatico`, `DetalleDesglose`, `TipoFactura`, `SiNo`, `CadenaAltaInput`, `CadenaAnulacionInput`

- [ ] **Step 1: Write the types**

`packages/verifactu/src/types.ts`. Field names mirror AEAT's XSD exactly — these map 1:1 to XML elements, and renaming them would make the conformance vectors unreadable against the source.

```ts
export type SiNo = "S" | "N";
export type TipoFactura = "F1" | "F2" | "F3" | "R1" | "R2" | "R3" | "R4" | "R5";
export type TipoHuella = "01";

export interface IDFactura {
  IDEmisorFactura: string;
  NumSerieFactura: string;
  FechaExpedicionFactura: string;
}

export interface IDFacturaAnulada {
  IDEmisorFacturaAnulada: string;
  NumSerieFacturaAnulada: string;
  FechaExpedicionFacturaAnulada: string;
}

/**
 * The four-part predecessor pointer. Note the sub-element names are the
 * alta-style ones in BOTH record types — a RegistroAnulacion chaining to a
 * predecessor still uses IDEmisorFactura, not IDEmisorFacturaAnulada. The
 * ...Anulada names appear only in RegistroAnulacion/IDFactura.
 */
export interface RegistroAnterior {
  IDEmisorFactura: string;
  NumSerieFactura: string;
  FechaExpedicionFactura: string;
  Huella: string;
}

/** Exclusive choice: exactly one branch, never both, never neither. */
export type Encadenamiento = { PrimerRegistro: "S" } | { RegistroAnterior: RegistroAnterior };

export interface SistemaInformatico {
  NombreRazon: string;
  NIF: string;
  NombreSistemaInformatico: string;
  IdSistemaInformatico: string;
  Version: string;
  NumeroInstalacion: string;
  TipoUsoPosibleSoloVerifactu: SiNo;
  TipoUsoPosibleMultiOT: SiNo;
  IndicadorMultiplesOT: SiNo;
}

export interface DetalleDesglose {
  Impuesto?: string;
  ClaveRegimen?: string;
  CalificacionOperacion?: string;
  OperacionExenta?: string;
  TipoImpositivo?: string;
  BaseImponibleOimporteNoSujeto: string;
  BaseImponibleACoste?: string;
  CuotaRepercutida?: string;
  TipoRecargoEquivalencia?: string;
  CuotaRecargoEquivalencia?: string;
}

export interface RegistroAlta {
  IDVersion: "1.0";
  IDFactura: IDFactura;
  RefExterna?: string;
  NombreRazonEmisor: string;
  Subsanacion?: SiNo;
  RechazoPrevio?: "N" | "S" | "X";
  TipoFactura: TipoFactura;
  TipoRectificativa?: "S" | "I";
  FechaOperacion?: string;
  DescripcionOperacion: string;
  FacturaSimplificadaArt7273?: SiNo;
  FacturaSinIdentifDestinatarioArt61d?: SiNo;
  Macrodato?: SiNo;
  Cupon?: SiNo;
  Desglose: DetalleDesglose[];
  CuotaTotal: string;
  ImporteTotal: string;
  Encadenamiento: Encadenamiento;
  SistemaInformatico: SistemaInformatico;
  FechaHoraHusoGenRegistro: string;
  TipoHuella: TipoHuella;
  Huella: string;
}

export interface RegistroAnulacion {
  IDVersion: "1.0";
  IDFactura: IDFacturaAnulada;
  RefExterna?: string;
  SinRegistroPrevio?: SiNo;
  RechazoPrevio?: SiNo;
  GeneradoPor?: "E" | "D" | "T";
  Encadenamiento: Encadenamiento;
  SistemaInformatico: SistemaInformatico;
  FechaHoraHusoGenRegistro: string;
  TipoHuella: TipoHuella;
  Huella: string;
}

/** Exactly the eight fields that feed the alta huella, in order. */
export interface CadenaAltaInput {
  IDEmisorFactura: string;
  NumSerieFactura: string;
  FechaExpedicionFactura: string;
  TipoFactura: string;
  CuotaTotal: string;
  ImporteTotal: string;
  huellaAnterior: string;
  FechaHoraHusoGenRegistro: string;
}

/** Exactly the five fields that feed the anulación huella, in order. */
export interface CadenaAnulacionInput {
  IDEmisorFacturaAnulada: string;
  NumSerieFacturaAnulada: string;
  FechaExpedicionFacturaAnulada: string;
  huellaAnterior: string;
  FechaHoraHusoGenRegistro: string;
}
```

- [ ] **Step 2: Transcribe AEAT's official vectors**

`packages/verifactu/test/vectors.ts`. These are AEAT's own worked examples from the huella specification v0.1.2 §6, reproduced verbatim. Do not adjust them to match an implementation — if a test fails, the implementation is wrong.

```ts
import type { CadenaAltaInput, CadenaAnulacionInput } from "../src/types.js";

/** Huella spec v0.1.2 §6.1 — first record of a chain, so no predecessor. */
export const VECTOR_1_INPUT: CadenaAltaInput = {
  IDEmisorFactura: "89890001K",
  NumSerieFactura: "12345678/G33",
  FechaExpedicionFactura: "01-01-2024",
  TipoFactura: "F1",
  CuotaTotal: "12.35",
  ImporteTotal: "123.45",
  huellaAnterior: "",
  FechaHoraHusoGenRegistro: "2024-01-01T19:20:30+01:00",
};

export const VECTOR_1_CADENA =
  "IDEmisorFactura=89890001K&NumSerieFactura=12345678/G33&FechaExpedicionFactura=01-01-2024" +
  "&TipoFactura=F1&CuotaTotal=12.35&ImporteTotal=123.45&Huella=" +
  "&FechaHoraHusoGenRegistro=2024-01-01T19:20:30+01:00";

export const VECTOR_1_HUELLA = "3C464DAF61ACB827C65FDA19F352A4E3BDC2C640E9E9FC4CC058073F38F12F60";

/** Huella spec v0.1.2 §6.2 — alta chained onto vector 1. */
export const VECTOR_2_INPUT: CadenaAltaInput = {
  IDEmisorFactura: "89890001K",
  NumSerieFactura: "12345679/G34",
  FechaExpedicionFactura: "01-01-2024",
  TipoFactura: "F1",
  CuotaTotal: "12.35",
  ImporteTotal: "123.45",
  huellaAnterior: VECTOR_1_HUELLA,
  FechaHoraHusoGenRegistro: "2024-01-01T19:20:35+01:00",
};

export const VECTOR_2_HUELLA = "F7B94CFD8924EDFF273501B01EE5153E4CE8F259766F88CF6ACB8935802A2B97";

/** Huella spec v0.1.2 §6.3 — anulación chained onto vector 2. Five fields, three renamed. */
export const VECTOR_3_INPUT: CadenaAnulacionInput = {
  IDEmisorFacturaAnulada: "89890001K",
  NumSerieFacturaAnulada: "12345679/G34",
  FechaExpedicionFacturaAnulada: "01-01-2024",
  huellaAnterior: VECTOR_2_HUELLA,
  FechaHoraHusoGenRegistro: "2024-01-01T19:20:40+01:00",
};

export const VECTOR_3_CADENA =
  "IDEmisorFacturaAnulada=89890001K&NumSerieFacturaAnulada=12345679/G34" +
  "&FechaExpedicionFacturaAnulada=01-01-2024&Huella=" +
  VECTOR_2_HUELLA +
  "&FechaHoraHusoGenRegistro=2024-01-01T19:20:40+01:00";

export const VECTOR_3_HUELLA = "177547C0D57AC74748561D054A9CEC14B4C4EA23D1BEFD6F2E69E3A388F90C68";
```

- [ ] **Step 3: Write the failing tests**

`packages/verifactu/src/huella.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  VECTOR_1_CADENA,
  VECTOR_1_HUELLA,
  VECTOR_1_INPUT,
  VECTOR_2_HUELLA,
  VECTOR_2_INPUT,
  VECTOR_3_CADENA,
  VECTOR_3_HUELLA,
  VECTOR_3_INPUT,
} from "../test/vectors.js";
import { buildCadenaAlta, buildCadenaAnulacion, computeHuella, huellaAnteriorOf, verifyHuella } from "./huella.js";
import type { RegistroAlta, RegistroAnulacion, SistemaInformatico } from "./types.js";

const SISTEMA: SistemaInformatico = {
  NombreRazon: "Waitron",
  NIF: "89890001K",
  NombreSistemaInformatico: "Waitron POS",
  IdSistemaInformatico: "WT",
  Version: "1.0.0",
  NumeroInstalacion: "001",
  TipoUsoPosibleSoloVerifactu: "S",
  TipoUsoPosibleMultiOT: "S",
  IndicadorMultiplesOT: "N",
};

describe("buildCadenaAlta", () => {
  it("reproduces AEAT's published string for vector 1 byte for byte", () => {
    expect(buildCadenaAlta(VECTOR_1_INPUT)).toBe(VECTOR_1_CADENA);
  });

  it("emits the key with an empty value when there is no predecessor", () => {
    expect(buildCadenaAlta(VECTOR_1_INPUT)).toContain("&Huella=&FechaHoraHusoGenRegistro=");
  });

  it("has no trailing separator", () => {
    const cadena = buildCadenaAlta(VECTOR_1_INPUT);
    expect(cadena.endsWith("&")).toBe(false);
    expect(cadena.endsWith("=")).toBe(false);
    expect(cadena).toBe(cadena.trimEnd());
  });

  it("always emits exactly seven separators, present fields or not", () => {
    // The key is never omitted, so the separator count is fixed. If an absent
    // field dropped its key, this would be six.
    expect(buildCadenaAlta(VECTOR_1_INPUT).split("&")).toHaveLength(8);
  });

  it("trims each value before concatenating", () => {
    const cadena = buildCadenaAlta({ ...VECTOR_1_INPUT, NumSerieFactura: "  12345678/G33  " });
    expect(cadena).toBe(VECTOR_1_CADENA);
  });
});

describe("buildCadenaAnulacion", () => {
  it("reproduces AEAT's published string for vector 3 byte for byte", () => {
    expect(buildCadenaAnulacion(VECTOR_3_INPUT)).toBe(VECTOR_3_CADENA);
  });

  it("uses the ...Anulada key names", () => {
    const cadena = buildCadenaAnulacion(VECTOR_3_INPUT);
    expect(cadena.startsWith("IDEmisorFacturaAnulada=")).toBe(true);
    expect(cadena).toContain("NumSerieFacturaAnulada=");
    expect(cadena).toContain("FechaExpedicionFacturaAnulada=");
  });

  it("names the predecessor field Huella, not HuellaAnulada", () => {
    expect(buildCadenaAnulacion(VECTOR_3_INPUT)).toContain("&Huella=");
    expect(buildCadenaAnulacion(VECTOR_3_INPUT)).not.toContain("HuellaAnulada=");
  });

  it("carries no TipoFactura, CuotaTotal or ImporteTotal", () => {
    const cadena = buildCadenaAnulacion(VECTOR_3_INPUT);
    expect(cadena).not.toContain("TipoFactura");
    expect(cadena).not.toContain("CuotaTotal");
    expect(cadena).not.toContain("ImporteTotal");
  });

  it("always emits exactly four separators", () => {
    expect(buildCadenaAnulacion(VECTOR_3_INPUT).split("&")).toHaveLength(5);
  });
});

describe("AEAT official vectors", () => {
  it("matches vector 1 — alta, first record", () => {
    expect(computeHuella(altaRecord(VECTOR_1_INPUT, { PrimerRegistro: "S" }))).toBe(VECTOR_1_HUELLA);
  });

  it("matches vector 2 — alta chained to vector 1", () => {
    expect(computeHuella(altaRecord(VECTOR_2_INPUT, previous(VECTOR_1_HUELLA)))).toBe(VECTOR_2_HUELLA);
  });

  it("matches vector 3 — anulación chained to vector 2", () => {
    expect(computeHuella(anulacionRecord(VECTOR_3_INPUT, previous(VECTOR_2_HUELLA)))).toBe(
      VECTOR_3_HUELLA,
    );
  });

  it("forms a valid three-record chain", () => {
    // The vectors chain v1 -> v2 -> v3, so this exercises chaining rather than
    // three unrelated hashes. Each record's predecessor pointer must carry the
    // hash the previous step actually produced.
    const h1 = computeHuella(altaRecord(VECTOR_1_INPUT, { PrimerRegistro: "S" }));
    const h2 = computeHuella(altaRecord(VECTOR_2_INPUT, previous(h1)));
    const h3 = computeHuella(anulacionRecord(VECTOR_3_INPUT, previous(h2)));
    expect([h1, h2, h3]).toEqual([VECTOR_1_HUELLA, VECTOR_2_HUELLA, VECTOR_3_HUELLA]);
  });
});

describe("computeHuella", () => {
  it("returns 64 uppercase hex characters", () => {
    expect(computeHuella(altaRecord(VECTOR_1_INPUT, { PrimerRegistro: "S" }))).toMatch(
      /^[0-9A-F]{64}$/,
    );
  });

  it("ignores the record's own Huella field", () => {
    // The record's Huella is the output, not an input. If it leaked into the
    // canonical string the hash would be self-referential and unverifiable.
    const record = altaRecord(VECTOR_1_INPUT, { PrimerRegistro: "S" });
    expect(computeHuella({ ...record, Huella: "TAMPERED" })).toBe(VECTOR_1_HUELLA);
  });

  it("changes when any hashed field changes", () => {
    const record = altaRecord(VECTOR_1_INPUT, { PrimerRegistro: "S" });
    expect(computeHuella({ ...record, ImporteTotal: "123.46" })).not.toBe(VECTOR_1_HUELLA);
  });

  it("distinguishes 123.1 from 123.10", () => {
    // AEAT recomputes from the literal it received, so these legitimately
    // differ. This is why records carry pre-formatted strings.
    const record = altaRecord(VECTOR_1_INPUT, { PrimerRegistro: "S" });
    expect(computeHuella({ ...record, ImporteTotal: "123.1" })).not.toBe(
      computeHuella({ ...record, ImporteTotal: "123.10" }),
    );
  });

  it("dispatches on record shape", () => {
    expect(computeHuella(anulacionRecord(VECTOR_3_INPUT, previous(VECTOR_2_HUELLA)))).toBe(
      VECTOR_3_HUELLA,
    );
  });
});

describe("verifyHuella", () => {
  it("accepts a record whose stored huella matches its content", () => {
    const record = altaRecord(VECTOR_1_INPUT, { PrimerRegistro: "S" });
    expect(verifyHuella({ ...record, Huella: VECTOR_1_HUELLA })).toBe(true);
  });

  it("rejects a record whose content was altered after hashing", () => {
    const record = altaRecord(VECTOR_1_INPUT, { PrimerRegistro: "S" });
    expect(verifyHuella({ ...record, ImporteTotal: "999.99", Huella: VECTOR_1_HUELLA })).toBe(false);
  });

  it("rejects a record whose stored huella was altered", () => {
    const record = altaRecord(VECTOR_1_INPUT, { PrimerRegistro: "S" });
    expect(verifyHuella({ ...record, Huella: "0".repeat(64) })).toBe(false);
  });

  it("is case sensitive on the stored huella", () => {
    const record = altaRecord(VECTOR_1_INPUT, { PrimerRegistro: "S" });
    expect(verifyHuella({ ...record, Huella: VECTOR_1_HUELLA.toLowerCase() })).toBe(false);
  });
});

describe("huellaAnteriorOf", () => {
  it("returns the empty string for a first record", () => {
    expect(huellaAnteriorOf({ PrimerRegistro: "S" })).toBe("");
  });

  it("returns the predecessor's full 64-character huella, unmodified", () => {
    expect(huellaAnteriorOf(previous(VECTOR_1_HUELLA))).toBe(VECTOR_1_HUELLA);
  });
});

function previous(huella: string) {
  return {
    RegistroAnterior: {
      IDEmisorFactura: "89890001K",
      NumSerieFactura: "12345678/G33",
      FechaExpedicionFactura: "01-01-2024",
      Huella: huella,
    },
  };
}

function altaRecord(
  input: typeof VECTOR_1_INPUT,
  Encadenamiento: RegistroAlta["Encadenamiento"],
): RegistroAlta {
  return {
    IDVersion: "1.0",
    IDFactura: {
      IDEmisorFactura: input.IDEmisorFactura,
      NumSerieFactura: input.NumSerieFactura,
      FechaExpedicionFactura: input.FechaExpedicionFactura,
    },
    NombreRazonEmisor: "Waitron SL",
    TipoFactura: "F1",
    DescripcionOperacion: "Venta en establecimiento",
    Desglose: [{ BaseImponibleOimporteNoSujeto: "111.10", CuotaRepercutida: "12.35" }],
    CuotaTotal: input.CuotaTotal,
    ImporteTotal: input.ImporteTotal,
    Encadenamiento,
    SistemaInformatico: SISTEMA,
    FechaHoraHusoGenRegistro: input.FechaHoraHusoGenRegistro,
    TipoHuella: "01",
    Huella: "",
  };
}

function anulacionRecord(
  input: typeof VECTOR_3_INPUT,
  Encadenamiento: RegistroAnulacion["Encadenamiento"],
): RegistroAnulacion {
  return {
    IDVersion: "1.0",
    IDFactura: {
      IDEmisorFacturaAnulada: input.IDEmisorFacturaAnulada,
      NumSerieFacturaAnulada: input.NumSerieFacturaAnulada,
      FechaExpedicionFacturaAnulada: input.FechaExpedicionFacturaAnulada,
    },
    Encadenamiento,
    SistemaInformatico: SISTEMA,
    FechaHoraHusoGenRegistro: input.FechaHoraHusoGenRegistro,
    TipoHuella: "01",
    Huella: "",
  };
}
```

- [ ] **Step 4: Run each test individually and watch it fail**

```bash
cd packages/verifactu
pnpm vitest run -t "reproduces AEAT's published string for vector 1 byte for byte"
```

Expected: FAIL — `Failed to resolve import "./huella.js"`.

Repeat for every test name. Pay particular attention to the three vector tests and the chain test: if any of those passes before `huella.ts` exists, something is very wrong.

- [ ] **Step 5: Implement**

`packages/verifactu/src/huella.ts`:

```ts
import { createHash } from "node:crypto";
import { trimValue } from "./format.js";
import type {
  CadenaAltaInput,
  CadenaAnulacionInput,
  Encadenamiento,
  RegistroAlta,
  RegistroAnulacion,
} from "./types.js";

/**
 * Joins ordered name/value pairs into AEAT's canonical hash input.
 *
 * Deliberately an ordered array of tuples rather than an object: the evento
 * record (not implemented here) repeats the key `NIF` twice, which an object
 * would silently collapse. Keeping the shape correct from the start costs
 * nothing and removes a trap later.
 *
 * The key is never omitted. An absent value contributes `Nombre=` and still
 * consumes its separator, so the separator count is fixed: 7 for alta, 4 for
 * anulación. There is no trailing separator.
 */
function joinCampos(campos: ReadonlyArray<readonly [string, string]>): string {
  return campos.map(([nombre, valor]) => `${nombre}=${trimValue(valor)}`).join("&");
}

/** Extracts the predecessor huella — empty for the first record of a chain. */
export function huellaAnteriorOf(encadenamiento: Encadenamiento): string {
  return "RegistroAnterior" in encadenamiento ? encadenamiento.RegistroAnterior.Huella : "";
}

export function buildCadenaAlta(input: CadenaAltaInput): string {
  return joinCampos([
    ["IDEmisorFactura", input.IDEmisorFactura],
    ["NumSerieFactura", input.NumSerieFactura],
    ["FechaExpedicionFactura", input.FechaExpedicionFactura],
    ["TipoFactura", input.TipoFactura],
    ["CuotaTotal", input.CuotaTotal],
    ["ImporteTotal", input.ImporteTotal],
    // The PREVIOUS record's huella, from Encadenamiento/RegistroAnterior/Huella
    // — never this record's own Huella, which is the output.
    ["Huella", input.huellaAnterior],
    ["FechaHoraHusoGenRegistro", input.FechaHoraHusoGenRegistro],
  ]);
}

export function buildCadenaAnulacion(input: CadenaAnulacionInput): string {
  return joinCampos([
    ["IDEmisorFacturaAnulada", input.IDEmisorFacturaAnulada],
    ["NumSerieFacturaAnulada", input.NumSerieFacturaAnulada],
    ["FechaExpedicionFacturaAnulada", input.FechaExpedicionFacturaAnulada],
    // Named plainly `Huella`, not `HuellaAnulada`.
    ["Huella", input.huellaAnterior],
    ["FechaHoraHusoGenRegistro", input.FechaHoraHusoGenRegistro],
  ]);
}

function isAlta(record: RegistroAlta | RegistroAnulacion): record is RegistroAlta {
  return "TipoFactura" in record;
}

/** Builds the canonical string for either record type. */
export function buildCadena(record: RegistroAlta | RegistroAnulacion): string {
  const huellaAnterior = huellaAnteriorOf(record.Encadenamiento);
  if (isAlta(record)) {
    return buildCadenaAlta({
      IDEmisorFactura: record.IDFactura.IDEmisorFactura,
      NumSerieFactura: record.IDFactura.NumSerieFactura,
      FechaExpedicionFactura: record.IDFactura.FechaExpedicionFactura,
      TipoFactura: record.TipoFactura,
      CuotaTotal: record.CuotaTotal,
      ImporteTotal: record.ImporteTotal,
      huellaAnterior,
      FechaHoraHusoGenRegistro: record.FechaHoraHusoGenRegistro,
    });
  }
  return buildCadenaAnulacion({
    IDEmisorFacturaAnulada: record.IDFactura.IDEmisorFacturaAnulada,
    NumSerieFacturaAnulada: record.IDFactura.NumSerieFacturaAnulada,
    FechaExpedicionFacturaAnulada: record.IDFactura.FechaExpedicionFacturaAnulada,
    huellaAnterior,
    FechaHoraHusoGenRegistro: record.FechaHoraHusoGenRegistro,
  });
}

/**
 * SHA-256 over the UTF-8 bytes of the canonical string, uppercase hex.
 * `TipoHuella` "01" denotes SHA-256 and is currently the only permitted value.
 */
export function computeHuella(record: RegistroAlta | RegistroAnulacion): string {
  return createHash("sha256").update(buildCadena(record), "utf8").digest("hex").toUpperCase();
}

/**
 * Art. 7.i support: does this record's stored huella match its own content?
 *
 * Detects tampering with a record after it was hashed. Note this is only half
 * of the art. 7.i duty — the caller must also check that the record's
 * predecessor pointer matches the actual predecessor's huella.
 */
export function verifyHuella(record: RegistroAlta | RegistroAnulacion): boolean {
  return record.Huella === computeHuella(record);
}
```

- [ ] **Step 6: Run the tests and verify they pass**

```bash
pnpm vitest run src/huella.test.ts
```

Expected: PASS, 24 tests — including all three AEAT vectors and the chain test.

- [ ] **Step 7: Teeth check — break it and watch it scream**

Confirm the vector tests have teeth rather than merely executing the code.

Temporarily change the `&` separator in `joinCampos` to `;` and run:

```bash
pnpm vitest run src/huella.test.ts
```

Expected: FAIL — all three vector tests and the chain test. Restore the `&`.

Now temporarily change `.toUpperCase()` to `.toLowerCase()`:

Expected: FAIL — the vector tests and the `/^[0-9A-F]{64}$/` test. Restore it.

Finally, temporarily make `huellaAnteriorOf` return `record.Huella` instead of the predecessor's:

Expected: FAIL — vectors 2 and 3 and the chain test. Restore it.

If any of those three mutations leaves the suite green, a test is missing.

- [ ] **Step 8: Verify the mutation score**

```bash
pnpm mutation
```

Expected: score ≥ 90, no surviving mutants in `huella.ts`.

- [ ] **Step 9: Export from the public surface**

`packages/verifactu/src/index.ts`:

```ts
// The entire public surface of @waitron/verifactu. Re-exports only — no logic here.
export { buildCadena, buildCadenaAlta, buildCadenaAnulacion, computeHuella, huellaAnteriorOf, verifyHuella } from "./huella.js";
export type * from "./types.js";
```

- [ ] **Step 10: Commit**

```bash
git add packages/verifactu/src packages/verifactu/test
git commit -m "feat(verifactu): huella construction, hashing and chain verification

Implements AEAT's canonical hash input for both record types and verifies
against the three official worked examples from the huella specification
v0.1.2 §6. Those vectors chain v1 -> v2 -> v3, so they exercise chaining
rather than three isolated hashes.

Two traps the tests pin down explicitly: the Huella field in the input
string is the PREVIOUS record's hash rather than the record's own, and the
anulación variant renames three keys but leaves the fourth as plain Huella.

Ordered tuples rather than an object, because the evento record repeats a
key and an object would silently collapse it."
```

---

## Task 4: Record construction

Takes native values (`number`, `Date`), applies the serialisation policy exactly once, and returns a record whose literals feed both the XML and the hash. This is the seam that guarantees "serialise once, hash that exact literal".

**Files:**

- Create: `packages/verifactu/src/records.ts`
- Create: `packages/verifactu/src/records.test.ts`
- Modify: `packages/verifactu/src/types.ts` (append the input types)

**Interfaces:**

- Consumes: `formatAmount`, `formatDate`, `formatDateTime`; `computeHuella`.
- Produces: `buildAltaRecord(input: AltaInput): RegistroAlta`, `buildAnulacionRecord(input: AnulacionInput): RegistroAnulacion`, types `AltaInput`, `AnulacionInput`, `DetalleDesgloseInput`.

- [ ] **Step 1: Append the input types to `types.ts`**

```ts
export interface DetalleDesgloseInput {
  Impuesto?: string;
  ClaveRegimen?: string;
  CalificacionOperacion?: string;
  OperacionExenta?: string;
  TipoImpositivo?: number;
  BaseImponibleOimporteNoSujeto: number;
  CuotaRepercutida?: number;
  TipoRecargoEquivalencia?: number;
  CuotaRecargoEquivalencia?: number;
}

export interface AltaInput {
  IDEmisorFactura: string;
  NumSerieFactura: string;
  FechaExpedicionFactura: Date;
  NombreRazonEmisor: string;
  TipoFactura: TipoFactura;
  DescripcionOperacion: string;
  Desglose: DetalleDesgloseInput[];
  CuotaTotal: number;
  ImporteTotal: number;
  Encadenamiento: Encadenamiento;
  SistemaInformatico: SistemaInformatico;
  generadoEn: Date;
  /** Minutes east of UTC. Explicit because a Date carries no zone of its own. */
  offsetMinutes: number;
  RefExterna?: string;
}

export interface AnulacionInput {
  IDEmisorFacturaAnulada: string;
  NumSerieFacturaAnulada: string;
  FechaExpedicionFacturaAnulada: Date;
  Encadenamiento: Encadenamiento;
  SistemaInformatico: SistemaInformatico;
  generadoEn: Date;
  offsetMinutes: number;
  RefExterna?: string;
  SinRegistroPrevio?: SiNo;
  GeneradoPor?: "E" | "D" | "T";
}
```

- [ ] **Step 2: Write the failing tests**

`packages/verifactu/src/records.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildAltaRecord, buildAnulacionRecord } from "./records.js";
import { computeHuella } from "./huella.js";
import { VECTOR_1_HUELLA } from "../test/vectors.js";
import type { AltaInput, AnulacionInput, SistemaInformatico } from "./types.js";

const SISTEMA: SistemaInformatico = {
  NombreRazon: "Waitron",
  NIF: "89890001K",
  NombreSistemaInformatico: "Waitron POS",
  IdSistemaInformatico: "WT",
  Version: "1.0.0",
  NumeroInstalacion: "001",
  TipoUsoPosibleSoloVerifactu: "S",
  TipoUsoPosibleMultiOT: "S",
  IndicadorMultiplesOT: "N",
};

const ALTA: AltaInput = {
  IDEmisorFactura: "89890001K",
  NumSerieFactura: "12345678/G33",
  FechaExpedicionFactura: new Date("2024-01-01T00:00:00+01:00"),
  NombreRazonEmisor: "Waitron SL",
  TipoFactura: "F1",
  DescripcionOperacion: "Venta en establecimiento",
  Desglose: [{ BaseImponibleOimporteNoSujeto: 111.1, CuotaRepercutida: 12.35, TipoImpositivo: 21 }],
  CuotaTotal: 12.35,
  ImporteTotal: 123.45,
  Encadenamiento: { PrimerRegistro: "S" },
  SistemaInformatico: SISTEMA,
  generadoEn: new Date("2024-01-01T19:20:30+01:00"),
  offsetMinutes: 60,
};

describe("buildAltaRecord", () => {
  it("reproduces AEAT's vector 1 huella from native inputs", () => {
    // End-to-end proof that the formatting policy produces the literals AEAT
    // hashed. If any formatter drifts, this breaks.
    expect(buildAltaRecord(ALTA).Huella).toBe(VECTOR_1_HUELLA);
  });

  it("formats amounts to two decimals in the record", () => {
    const record = buildAltaRecord(ALTA);
    expect(record.CuotaTotal).toBe("12.35");
    expect(record.ImporteTotal).toBe("123.45");
  });

  it("formats the expedition date as DD-MM-YYYY", () => {
    expect(buildAltaRecord(ALTA).IDFactura.FechaExpedicionFactura).toBe("01-01-2024");
  });

  it("formats the generation timestamp with a numeric offset", () => {
    expect(buildAltaRecord(ALTA).FechaHoraHusoGenRegistro).toBe("2024-01-01T19:20:30+01:00");
  });

  it("sets IDVersion and TipoHuella to their only permitted values", () => {
    const record = buildAltaRecord(ALTA);
    expect(record.IDVersion).toBe("1.0");
    expect(record.TipoHuella).toBe("01");
  });

  it("computes a huella consistent with computeHuella on the result", () => {
    const record = buildAltaRecord(ALTA);
    expect(computeHuella(record)).toBe(record.Huella);
  });

  it("stores a huella even for the first record of a chain", () => {
    // AEAT: the huella is always informed, "incluso en el caso de que sea el
    // primer registro".
    expect(buildAltaRecord(ALTA).Huella).toMatch(/^[0-9A-F]{64}$/);
  });

  it("formats desglose amounts too", () => {
    const record = buildAltaRecord(ALTA);
    expect(record.Desglose[0]?.BaseImponibleOimporteNoSujeto).toBe("111.10");
    expect(record.Desglose[0]?.CuotaRepercutida).toBe("12.35");
    expect(record.Desglose[0]?.TipoImpositivo).toBe("21.00");
  });

  it("omits optional desglose fields that were not supplied", () => {
    const record = buildAltaRecord(ALTA);
    expect(record.Desglose[0]?.CuotaRecargoEquivalencia).toBeUndefined();
  });
});

describe("buildAnulacionRecord", () => {
  const ANULACION: AnulacionInput = {
    IDEmisorFacturaAnulada: "89890001K",
    NumSerieFacturaAnulada: "12345679/G34",
    FechaExpedicionFacturaAnulada: new Date("2024-01-01T00:00:00+01:00"),
    Encadenamiento: {
      RegistroAnterior: {
        IDEmisorFactura: "89890001K",
        NumSerieFactura: "12345679/G34",
        FechaExpedicionFactura: "01-01-2024",
        Huella: "F7B94CFD8924EDFF273501B01EE5153E4CE8F259766F88CF6ACB8935802A2B97",
      },
    },
    SistemaInformatico: SISTEMA,
    generadoEn: new Date("2024-01-01T19:20:40+01:00"),
    offsetMinutes: 60,
  };

  it("reproduces AEAT's vector 3 huella from native inputs", () => {
    expect(buildAnulacionRecord(ANULACION).Huella).toBe(
      "177547C0D57AC74748561D054A9CEC14B4C4EA23D1BEFD6F2E69E3A388F90C68",
    );
  });

  it("uses the ...Anulada identity field names", () => {
    const record = buildAnulacionRecord(ANULACION);
    expect(record.IDFactura.IDEmisorFacturaAnulada).toBe("89890001K");
    expect(record.IDFactura.FechaExpedicionFacturaAnulada).toBe("01-01-2024");
  });

  it("carries no TipoFactura or totals", () => {
    const record = buildAnulacionRecord(ANULACION) as Record<string, unknown>;
    expect(record.TipoFactura).toBeUndefined();
    expect(record.CuotaTotal).toBeUndefined();
    expect(record.ImporteTotal).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run each test individually and watch it fail**

```bash
pnpm vitest run -t "reproduces AEAT's vector 1 huella from native inputs"
```

Expected: FAIL — `Failed to resolve import "./records.js"`. Repeat per test.

- [ ] **Step 4: Implement**

`packages/verifactu/src/records.ts`:

```ts
import { formatAmount, formatDate, formatDateTime } from "./format.js";
import { computeHuella } from "./huella.js";
import type {
  AltaInput,
  AnulacionInput,
  DetalleDesglose,
  DetalleDesgloseInput,
  RegistroAlta,
  RegistroAnulacion,
} from "./types.js";

function formatDetalle(detalle: DetalleDesgloseInput): DetalleDesglose {
  return {
    ...(detalle.Impuesto !== undefined && { Impuesto: detalle.Impuesto }),
    ...(detalle.ClaveRegimen !== undefined && { ClaveRegimen: detalle.ClaveRegimen }),
    ...(detalle.CalificacionOperacion !== undefined && {
      CalificacionOperacion: detalle.CalificacionOperacion,
    }),
    ...(detalle.OperacionExenta !== undefined && { OperacionExenta: detalle.OperacionExenta }),
    ...(detalle.TipoImpositivo !== undefined && {
      TipoImpositivo: formatAmount(detalle.TipoImpositivo),
    }),
    BaseImponibleOimporteNoSujeto: formatAmount(detalle.BaseImponibleOimporteNoSujeto),
    ...(detalle.CuotaRepercutida !== undefined && {
      CuotaRepercutida: formatAmount(detalle.CuotaRepercutida),
    }),
    ...(detalle.TipoRecargoEquivalencia !== undefined && {
      TipoRecargoEquivalencia: formatAmount(detalle.TipoRecargoEquivalencia),
    }),
    ...(detalle.CuotaRecargoEquivalencia !== undefined && {
      CuotaRecargoEquivalencia: formatAmount(detalle.CuotaRecargoEquivalencia),
    }),
  };
}

/**
 * Builds a registro de alta, formatting every value exactly once and hashing
 * the resulting literals. The returned record is complete and ready to
 * serialise — the same strings go into the XML and went into the hash, which
 * is the property AEAT's recomputation depends on.
 */
export function buildAltaRecord(input: AltaInput): RegistroAlta {
  const record: RegistroAlta = {
    IDVersion: "1.0",
    IDFactura: {
      IDEmisorFactura: input.IDEmisorFactura,
      NumSerieFactura: input.NumSerieFactura,
      FechaExpedicionFactura: formatDate(input.FechaExpedicionFactura, input.offsetMinutes),
    },
    ...(input.RefExterna !== undefined && { RefExterna: input.RefExterna }),
    NombreRazonEmisor: input.NombreRazonEmisor,
    TipoFactura: input.TipoFactura,
    DescripcionOperacion: input.DescripcionOperacion,
    Desglose: input.Desglose.map(formatDetalle),
    CuotaTotal: formatAmount(input.CuotaTotal),
    ImporteTotal: formatAmount(input.ImporteTotal),
    Encadenamiento: input.Encadenamiento,
    SistemaInformatico: input.SistemaInformatico,
    FechaHoraHusoGenRegistro: formatDateTime(input.generadoEn, input.offsetMinutes),
    TipoHuella: "01",
    Huella: "",
  };
  return { ...record, Huella: computeHuella(record) };
}

export function buildAnulacionRecord(input: AnulacionInput): RegistroAnulacion {
  const record: RegistroAnulacion = {
    IDVersion: "1.0",
    IDFactura: {
      IDEmisorFacturaAnulada: input.IDEmisorFacturaAnulada,
      NumSerieFacturaAnulada: input.NumSerieFacturaAnulada,
      FechaExpedicionFacturaAnulada: formatDate(
        input.FechaExpedicionFacturaAnulada,
        input.offsetMinutes,
      ),
    },
    ...(input.RefExterna !== undefined && { RefExterna: input.RefExterna }),
    ...(input.SinRegistroPrevio !== undefined && { SinRegistroPrevio: input.SinRegistroPrevio }),
    ...(input.GeneradoPor !== undefined && { GeneradoPor: input.GeneradoPor }),
    Encadenamiento: input.Encadenamiento,
    SistemaInformatico: input.SistemaInformatico,
    FechaHoraHusoGenRegistro: formatDateTime(input.generadoEn, input.offsetMinutes),
    TipoHuella: "01",
    Huella: "",
  };
  return { ...record, Huella: computeHuella(record) };
}
```

- [ ] **Step 5: Run tests, then commit**

```bash
pnpm vitest run src/records.test.ts
```

Expected: PASS, 12 tests.

```bash
git add packages/verifactu/src
git commit -m "feat(verifactu): record construction from native values

Formats every value exactly once and hashes the resulting literals, which
is what makes 'serialise once, hash that literal' structurally true rather
than a convention to remember.

Both builders are verified end to end against AEAT's official vectors from
native inputs, so a drift in any formatter breaks a vector test rather than
silently producing a valid-looking wrong hash."
```

---

## Task 5: Pre-flight validation

Catches locally what AEAT would otherwise reject or flag. This is what makes a genuine rejection nearly unreachable in production — spec §7 relies on that.

**Files:**

- Create: `packages/verifactu/src/validate.ts`
- Create: `packages/verifactu/src/validate.test.ts`

**Interfaces:**

- Consumes: types only.
- Produces: `validate(record: RegistroAlta | RegistroAnulacion): ValidationIssue[]`, types `ValidationIssue`, `ValidationSeverity`.

- [ ] **Step 1: Write the failing tests**

`packages/verifactu/src/validate.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { validate } from "./validate.js";
import { buildAltaRecord } from "./records.js";
import type { AltaInput, RegistroAlta, SistemaInformatico } from "./types.js";

const SISTEMA: SistemaInformatico = {
  NombreRazon: "Waitron",
  NIF: "89890001K",
  NombreSistemaInformatico: "Waitron POS",
  IdSistemaInformatico: "WT",
  Version: "1.0.0",
  NumeroInstalacion: "001",
  TipoUsoPosibleSoloVerifactu: "S",
  TipoUsoPosibleMultiOT: "S",
  IndicadorMultiplesOT: "N",
};

const INPUT: AltaInput = {
  IDEmisorFactura: "89890001K",
  NumSerieFactura: "12345678/G33",
  FechaExpedicionFactura: new Date("2024-01-01T00:00:00+01:00"),
  NombreRazonEmisor: "Waitron SL",
  TipoFactura: "F1",
  DescripcionOperacion: "Venta en establecimiento",
  Desglose: [{ BaseImponibleOimporteNoSujeto: 111.1, CuotaRepercutida: 12.35 }],
  CuotaTotal: 12.35,
  ImporteTotal: 123.45,
  Encadenamiento: { PrimerRegistro: "S" },
  SistemaInformatico: SISTEMA,
  generadoEn: new Date("2024-01-01T19:20:30+01:00"),
  offsetMinutes: 60,
};

const valid = () => buildAltaRecord(INPUT);
const codes = (record: RegistroAlta) => validate(record).map((issue) => issue.code);

describe("validate", () => {
  it("returns no issues for a well-formed record", () => {
    expect(validate(valid())).toEqual([]);
  });

  it("rejects a NIF that is not exactly nine characters", () => {
    const record = valid();
    record.IDFactura.IDEmisorFactura = "8989001K";
    expect(codes(record)).toContain("NIF_LENGTH");
  });

  it("rejects an empty NumSerieFactura", () => {
    const record = valid();
    record.IDFactura.NumSerieFactura = "";
    expect(codes(record)).toContain("NUMSERIE_LENGTH");
  });

  it("rejects a NumSerieFactura longer than 60 characters", () => {
    const record = valid();
    record.IDFactura.NumSerieFactura = "A".repeat(61);
    expect(codes(record)).toContain("NUMSERIE_LENGTH");
  });

  it("rejects a NumSerieFactura outside the safe charset", () => {
    // Policy: restrict the charset so form-urlencoding and RFC 3986 percent
    // encoding coincide in the QR, which removes an unresolved spec ambiguity.
    const record = valid();
    record.IDFactura.NumSerieFactura = "12345 678";
    expect(codes(record)).toContain("NUMSERIE_CHARSET");
  });

  it("rejects a Desglose with no lines", () => {
    const record = valid();
    record.Desglose = [];
    expect(codes(record)).toContain("DESGLOSE_COUNT");
  });

  it("rejects a Desglose with more than twelve lines", () => {
    const record = valid();
    record.Desglose = Array.from({ length: 13 }, () => ({
      BaseImponibleOimporteNoSujeto: "1.00",
    }));
    expect(codes(record)).toContain("DESGLOSE_COUNT");
  });

  it("flags CuotaTotal disagreeing with the desglose beyond tolerance", () => {
    const record = valid();
    record.CuotaTotal = "999.00";
    expect(codes(record)).toContain("CUOTA_TOTAL_MISMATCH");
  });

  it("accepts a CuotaTotal discrepancy within the 10 euro tolerance", () => {
    // AEAT applies a +/- 10.00 tolerance and treats a breach as a warning
    // rather than a rejection.
    const record = valid();
    record.CuotaTotal = "20.00";
    expect(codes(record)).not.toContain("CUOTA_TOTAL_MISMATCH");
  });

  it("flags ImporteTotal disagreeing with the desglose beyond tolerance", () => {
    const record = valid();
    record.ImporteTotal = "999.00";
    expect(codes(record)).toContain("IMPORTE_TOTAL_MISMATCH");
  });

  it("marks total mismatches as warnings, not errors", () => {
    // AEAT accepts these with errors rather than rejecting, so treating them
    // as fatal locally would block records AEAT would have taken.
    const record = valid();
    record.ImporteTotal = "999.00";
    const issue = validate(record).find((i) => i.code === "IMPORTE_TOTAL_MISMATCH");
    expect(issue?.severity).toBe("warning");
  });

  it("rejects a huella that is not 64 uppercase hex characters", () => {
    const record = valid();
    record.Huella = record.Huella.toLowerCase();
    expect(codes(record)).toContain("HUELLA_FORMAT");
  });

  it("rejects a predecessor huella that is not 64 uppercase hex characters", () => {
    const record = valid();
    record.Encadenamiento = {
      RegistroAnterior: {
        IDEmisorFactura: "89890001K",
        NumSerieFactura: "12345677/G32",
        FechaExpedicionFactura: "01-01-2024",
        Huella: "TOO-SHORT",
      },
    };
    expect(codes(record)).toContain("HUELLA_ANTERIOR_FORMAT");
  });

  it("rejects a predecessor huella equal to the record's own", () => {
    const record = valid();
    record.Encadenamiento = {
      RegistroAnterior: {
        IDEmisorFactura: "89890001K",
        NumSerieFactura: "12345677/G32",
        FechaExpedicionFactura: "01-01-2024",
        Huella: record.Huella,
      },
    };
    expect(codes(record)).toContain("HUELLA_ANTERIOR_EQUALS_CURRENT");
  });

  it("rejects an IdSistemaInformatico longer than two characters", () => {
    const record = valid();
    record.SistemaInformatico = { ...SISTEMA, IdSistemaInformatico: "WTX" };
    expect(codes(record)).toContain("ID_SISTEMA_LENGTH");
  });

  it("rejects a DescripcionOperacion longer than 500 characters", () => {
    const record = valid();
    record.DescripcionOperacion = "x".repeat(501);
    expect(codes(record)).toContain("DESCRIPCION_LENGTH");
  });

  it("rejects a malformed expedition date", () => {
    const record = valid();
    record.IDFactura.FechaExpedicionFactura = "2024-01-01";
    expect(codes(record)).toContain("FECHA_FORMAT");
  });

  it("reports every distinct problem rather than stopping at the first", () => {
    const record = valid();
    record.IDFactura.IDEmisorFactura = "SHORT";
    record.Desglose = [];
    expect(codes(record)).toEqual(expect.arrayContaining(["NIF_LENGTH", "DESGLOSE_COUNT"]));
  });
});
```

- [ ] **Step 2: Run each test individually and watch it fail**

```bash
pnpm vitest run -t "returns no issues for a well-formed record"
```

Expected: FAIL — unresolved import. Repeat per test.

- [ ] **Step 3: Implement**

`packages/verifactu/src/validate.ts`:

```ts
import type { RegistroAlta, RegistroAnulacion } from "./types.js";

export type ValidationSeverity = "error" | "warning";

export interface ValidationIssue {
  code: string;
  severity: ValidationSeverity;
  field: string;
  message: string;
}

const HUELLA_PATTERN = /^[0-9A-F]{64}$/;
const FECHA_PATTERN = /^\d{2}-\d{2}-\d{4}$/;
/**
 * Conservative charset for NumSerieFactura. AEAT permits printable ASCII, but
 * form-urlencoding and RFC 3986 disagree on characters like space, and the QR
 * spec does not settle which applies. Restricting the charset here makes the
 * two encodings identical, so the ambiguity cannot affect us.
 */
const NUMSERIE_PATTERN = /^[A-Za-z0-9/_.-]+$/;
/** AEAT applies a +/- 10.00 euro tolerance on the total cross-checks. */
const TOTAL_TOLERANCE = 10;

function isAlta(record: RegistroAlta | RegistroAnulacion): record is RegistroAlta {
  return "TipoFactura" in record;
}

function sum(values: Array<string | undefined>): number {
  return values.reduce<number>((total, value) => total + (value ? Number(value) : 0), 0);
}

export function validate(record: RegistroAlta | RegistroAnulacion): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const add = (
    code: string,
    field: string,
    message: string,
    severity: ValidationSeverity = "error",
  ) => issues.push({ code, severity, field, message });

  const emisor = isAlta(record)
    ? record.IDFactura.IDEmisorFactura
    : record.IDFactura.IDEmisorFacturaAnulada;
  const numSerie = isAlta(record)
    ? record.IDFactura.NumSerieFactura
    : record.IDFactura.NumSerieFacturaAnulada;
  const fecha = isAlta(record)
    ? record.IDFactura.FechaExpedicionFactura
    : record.IDFactura.FechaExpedicionFacturaAnulada;

  if (emisor.length !== 9) {
    add("NIF_LENGTH", "IDEmisorFactura", "NIF must be exactly 9 characters");
  }
  if (numSerie.length < 1 || numSerie.length > 60) {
    add("NUMSERIE_LENGTH", "NumSerieFactura", "NumSerieFactura must be 1 to 60 characters");
  } else if (!NUMSERIE_PATTERN.test(numSerie)) {
    add(
      "NUMSERIE_CHARSET",
      "NumSerieFactura",
      "NumSerieFactura must use only A-Z a-z 0-9 / _ . -",
    );
  }
  if (!FECHA_PATTERN.test(fecha)) {
    add("FECHA_FORMAT", "FechaExpedicionFactura", "Date must be DD-MM-YYYY");
  }

  if (!HUELLA_PATTERN.test(record.Huella)) {
    add("HUELLA_FORMAT", "Huella", "Huella must be 64 uppercase hexadecimal characters");
  }
  if (record.SistemaInformatico.IdSistemaInformatico.length > 2) {
    add("ID_SISTEMA_LENGTH", "IdSistemaInformatico", "IdSistemaInformatico is at most 2 characters");
  }

  if ("RegistroAnterior" in record.Encadenamiento) {
    const anterior = record.Encadenamiento.RegistroAnterior.Huella;
    if (!HUELLA_PATTERN.test(anterior)) {
      add(
        "HUELLA_ANTERIOR_FORMAT",
        "Encadenamiento.RegistroAnterior.Huella",
        "Predecessor huella must be 64 uppercase hexadecimal characters",
      );
    }
    if (anterior === record.Huella) {
      add(
        "HUELLA_ANTERIOR_EQUALS_CURRENT",
        "Encadenamiento.RegistroAnterior.Huella",
        "Predecessor huella must differ from this record's huella",
      );
    }
  }

  if (!isAlta(record)) return issues;

  if (record.DescripcionOperacion.length > 500) {
    add("DESCRIPCION_LENGTH", "DescripcionOperacion", "DescripcionOperacion is at most 500 characters");
  }
  if (record.Desglose.length < 1 || record.Desglose.length > 12) {
    add("DESGLOSE_COUNT", "Desglose", "Desglose must carry 1 to 12 detail lines");
  }

  // AEAT cross-checks totals against the desglose with a +/- 10.00 tolerance
  // and treats a breach as an admissible error, so these are warnings: failing
  // locally would block records AEAT would have accepted.
  const cuotas = sum(record.Desglose.map((d) => d.CuotaRepercutida));
  const recargos = sum(record.Desglose.map((d) => d.CuotaRecargoEquivalencia));
  const bases = sum(record.Desglose.map((d) => d.BaseImponibleOimporteNoSujeto));

  if (Math.abs(Number(record.CuotaTotal) - (cuotas + recargos)) > TOTAL_TOLERANCE) {
    add(
      "CUOTA_TOTAL_MISMATCH",
      "CuotaTotal",
      "CuotaTotal disagrees with the desglose beyond the 10.00 tolerance",
      "warning",
    );
  }
  if (Math.abs(Number(record.ImporteTotal) - (bases + cuotas + recargos)) > TOTAL_TOLERANCE) {
    add(
      "IMPORTE_TOTAL_MISMATCH",
      "ImporteTotal",
      "ImporteTotal disagrees with the desglose beyond the 10.00 tolerance",
      "warning",
    );
  }

  return issues;
}
```

- [ ] **Step 4: Run tests, then commit**

```bash
pnpm vitest run src/validate.test.ts
```

Expected: PASS, 19 tests.

```bash
git add packages/verifactu/src
git commit -m "feat(verifactu): pre-flight validation

Catches locally what AEAT would reject or flag, which is what makes a real
rejection nearly unreachable in production — the outbox design depends on
that, since a rejection halts a chain's queue.

Total cross-checks are warnings rather than errors, matching AEAT's own
treatment: it accepts them with errors inside a 10 euro tolerance, so
failing locally would block records AEAT would have taken."
```

---

## Task 6: QR payload

**Files:**

- Create: `packages/verifactu/src/endpoints.ts`
- Create: `packages/verifactu/src/qr.ts`
- Create: `packages/verifactu/src/qr.test.ts`

**Interfaces:**

- Consumes: types.
- Produces: `buildQrPayload(record: RegistroAlta, environment: Environment): string`, `type Environment = "production" | "preproduction"`, endpoint constants.

- [ ] **Step 1: Write the endpoints**

`packages/verifactu/src/endpoints.ts`:

```ts
export type Environment = "production" | "preproduction";

/** Submission and consulta are two operations on the same URL. */
export const SOAP_ENDPOINTS: Record<Environment, string> = {
  production: "https://www1.agenciatributaria.gob.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP",
  preproduction: "https://prewww1.aeat.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP",
};

/** Sello de entidad certificates use a different host. */
export const SOAP_ENDPOINTS_SELLO: Record<Environment, string> = {
  production: "https://www10.agenciatributaria.gob.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP",
  preproduction: "https://prewww10.aeat.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP",
};

/**
 * QR validation URLs. Note both the host AND the path change between
 * environments — production is agenciatributaria.gob.es, preproduction is
 * aeat.es. We build Veri*Factu mode only, so the NoVerifactu variants are
 * deliberately absent.
 */
export const QR_ENDPOINTS: Record<Environment, string> = {
  production: "https://www2.agenciatributaria.gob.es/wlpl/TIKE-CONT/ValidarQR",
  preproduction: "https://prewww2.aeat.es/wlpl/TIKE-CONT/ValidarQR",
};
```

- [ ] **Step 2: Write the failing tests**

`packages/verifactu/src/qr.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildQrPayload } from "./qr.js";
import { buildAltaRecord } from "./records.js";
import type { AltaInput, SistemaInformatico } from "./types.js";

const SISTEMA: SistemaInformatico = {
  NombreRazon: "Waitron",
  NIF: "89890001K",
  NombreSistemaInformatico: "Waitron POS",
  IdSistemaInformatico: "WT",
  Version: "1.0.0",
  NumeroInstalacion: "001",
  TipoUsoPosibleSoloVerifactu: "S",
  TipoUsoPosibleMultiOT: "S",
  IndicadorMultiplesOT: "N",
};

const record = buildAltaRecord({
  IDEmisorFactura: "89890001K",
  NumSerieFactura: "12345678-G33",
  FechaExpedicionFactura: new Date("2024-09-01T00:00:00+02:00"),
  NombreRazonEmisor: "Waitron SL",
  TipoFactura: "F1",
  DescripcionOperacion: "Venta",
  Desglose: [{ BaseImponibleOimporteNoSujeto: 199.5, CuotaRepercutida: 41.9 }],
  CuotaTotal: 41.9,
  ImporteTotal: 241.4,
  Encadenamiento: { PrimerRegistro: "S" },
  SistemaInformatico: SISTEMA,
  generadoEn: new Date("2024-09-01T10:00:00+02:00"),
  offsetMinutes: 120,
} satisfies AltaInput);

describe("buildQrPayload", () => {
  it("matches AEAT's published production example", () => {
    expect(buildQrPayload(record, "production")).toBe(
      "https://www2.agenciatributaria.gob.es/wlpl/TIKE-CONT/ValidarQR" +
        "?nif=89890001K&numserie=12345678-G33&fecha=01-09-2024&importe=241.40",
    );
  });

  it("matches AEAT's published preproduction example", () => {
    expect(buildQrPayload(record, "preproduction")).toBe(
      "https://prewww2.aeat.es/wlpl/TIKE-CONT/ValidarQR" +
        "?nif=89890001K&numserie=12345678-G33&fecha=01-09-2024&importe=241.40",
    );
  });

  it("emits exactly the four mandatory parameters in order", () => {
    const query = buildQrPayload(record, "production").split("?")[1] ?? "";
    expect(query.split("&").map((pair) => pair.split("=")[0])).toEqual([
      "nif",
      "numserie",
      "fecha",
      "importe",
    ]);
  });

  it("percent-encodes an ampersand in the serial", () => {
    // AEAT publishes the unencoded form as explicitly incorrect, because the
    // bare & would be read as a parameter separator.
    const withAmpersand = { ...record, IDFactura: { ...record.IDFactura, NumSerieFactura: "12345678&G33" } };
    expect(buildQrPayload(withAmpersand, "preproduction")).toContain("numserie=12345678%26G33");
  });

  it("never includes the formato parameter", () => {
    // AEAT: "este parametro nunca podra incorporarse en la URL que va en el
    // codigo QR de la factura".
    expect(buildQrPayload(record, "production")).not.toContain("formato");
  });

  it("uses the record's own literals rather than reformatting", () => {
    expect(buildQrPayload(record, "production")).toContain(`importe=${record.ImporteTotal}`);
  });
});
```

- [ ] **Step 3: Run each test individually and watch it fail**

Expected: FAIL — unresolved import `./qr.js`.

- [ ] **Step 4: Implement**

`packages/verifactu/src/qr.ts`:

```ts
import { QR_ENDPOINTS, type Environment } from "./endpoints.js";
import type { RegistroAlta } from "./types.js";

/**
 * Percent-encodes a parameter value.
 *
 * AEAT's reference uses Java's URLEncoder (form-urlencoding, space -> "+"),
 * while encodeURIComponent follows RFC 3986 (space -> "%20"). The spec does
 * not settle which applies. We restrict the NumSerieFactura charset in
 * validate() so no character where they differ can reach here, which makes
 * the choice unobservable rather than merely unlikely.
 */
function encodeParam(value: string): string {
  return encodeURIComponent(value);
}

/**
 * Builds the QR payload URL: exactly four mandatory parameters, in order.
 *
 * Values are taken from the record's own literals, never recomputed — the QR
 * must show what was hashed and sent.
 */
export function buildQrPayload(record: RegistroAlta, environment: Environment): string {
  const params = [
    ["nif", record.IDFactura.IDEmisorFactura],
    ["numserie", record.IDFactura.NumSerieFactura],
    ["fecha", record.IDFactura.FechaExpedicionFactura],
    ["importe", record.ImporteTotal],
  ] as const;
  const query = params.map(([name, value]) => `${name}=${encodeParam(value)}`).join("&");
  return `${QR_ENDPOINTS[environment]}?${query}`;
}
```

- [ ] **Step 5: Run tests, then commit**

```bash
pnpm vitest run src/qr.test.ts
```

Expected: PASS, 6 tests.

```bash
git add packages/verifactu/src
git commit -m "feat(verifactu): QR payload and AEAT endpoints

Verified against AEAT's published production and preproduction examples.
Both the host and the path change between environments, which is easy to
get half right.

Values come from the record's own literals rather than being recomputed —
the QR has to show what was hashed and sent."
```

---

## Task 7: XML serialisation

**Files:**

- Create: `packages/verifactu/src/xml/escape.ts`
- Create: `packages/verifactu/src/xml/serialize.ts`
- Create: `packages/verifactu/src/xml/serialize.test.ts`

**Interfaces:**

- Consumes: types.
- Produces: `serializeEnvio(cabecera: Cabecera, registros: EnvioRegistro[]): string`, `serializeConsulta(cabecera: Cabecera, filtro: ConsultaFiltro): string`, `escapeXml(value: string): string`, types `Cabecera`, `EnvioRegistro`, `ConsultaFiltro`.

- [ ] **Step 1: Write the failing tests**

`packages/verifactu/src/xml/serialize.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { escapeXml } from "./escape.js";
import { serializeConsulta, serializeEnvio } from "./serialize.js";
import { buildAltaRecord } from "../records.js";
import type { AltaInput, SistemaInformatico } from "../types.js";

const SISTEMA: SistemaInformatico = {
  NombreRazon: "Waitron",
  NIF: "89890001K",
  NombreSistemaInformatico: "Waitron POS",
  IdSistemaInformatico: "WT",
  Version: "1.0.0",
  NumeroInstalacion: "001",
  TipoUsoPosibleSoloVerifactu: "S",
  TipoUsoPosibleMultiOT: "S",
  IndicadorMultiplesOT: "N",
};

const CABECERA = { ObligadoEmision: { NombreRazon: "Waitron SL", NIF: "89890001K" } };

const record = buildAltaRecord({
  IDEmisorFactura: "89890001K",
  NumSerieFactura: "12345678/G33",
  FechaExpedicionFactura: new Date("2024-01-01T00:00:00+01:00"),
  NombreRazonEmisor: "Waitron SL",
  TipoFactura: "F1",
  DescripcionOperacion: "Venta en establecimiento",
  Desglose: [{ BaseImponibleOimporteNoSujeto: 111.1, CuotaRepercutida: 12.35, TipoImpositivo: 21 }],
  CuotaTotal: 12.35,
  ImporteTotal: 123.45,
  Encadenamiento: { PrimerRegistro: "S" },
  SistemaInformatico: SISTEMA,
  generadoEn: new Date("2024-01-01T19:20:30+01:00"),
  offsetMinutes: 60,
} satisfies AltaInput);

describe("escapeXml", () => {
  it("escapes the five XML metacharacters", () => {
    expect(escapeXml(`<&>"'`)).toBe("&lt;&amp;&gt;&quot;&apos;");
  });

  it("escapes ampersands before other entities, not after", () => {
    // Escaping & last would double-escape the entities just introduced,
    // turning < into &amp;lt;.
    expect(escapeXml("<")).toBe("&lt;");
  });

  it("leaves ordinary text untouched", () => {
    expect(escapeXml("12345678/G33")).toBe("12345678/G33");
  });
});

describe("serializeEnvio", () => {
  it("emits a SOAP envelope with one Cabecera and the ObligadoEmision", () => {
    const xml = serializeEnvio(CABECERA, [{ RegistroAlta: record }]);
    expect(xml).toContain("<sfLR:Cabecera>");
    expect(xml).toContain("<sf:ObligadoEmision>");
    expect(xml).toContain("<sf:NIF>89890001K</sf:NIF>");
  });

  it("emits the record's literals verbatim so the huella still verifies", () => {
    const xml = serializeEnvio(CABECERA, [{ RegistroAlta: record }]);
    expect(xml).toContain(`<sf:ImporteTotal>123.45</sf:ImporteTotal>`);
    expect(xml).toContain(`<sf:Huella>${record.Huella}</sf:Huella>`);
    expect(xml).toContain(
      "<sf:FechaHoraHusoGenRegistro>2024-01-01T19:20:30+01:00</sf:FechaHoraHusoGenRegistro>",
    );
  });

  it("emits PrimerRegistro for a first record and no RegistroAnterior", () => {
    const xml = serializeEnvio(CABECERA, [{ RegistroAlta: record }]);
    expect(xml).toContain("<sf:PrimerRegistro>S</sf:PrimerRegistro>");
    expect(xml).not.toContain("RegistroAnterior");
  });

  it("emits all four RegistroAnterior sub-fields when chained", () => {
    const chained = buildAltaRecord({
      IDEmisorFactura: "89890001K",
      NumSerieFactura: "12345679/G34",
      FechaExpedicionFactura: new Date("2024-01-01T00:00:00+01:00"),
      NombreRazonEmisor: "Waitron SL",
      TipoFactura: "F1",
      DescripcionOperacion: "Venta",
      Desglose: [{ BaseImponibleOimporteNoSujeto: 111.1, CuotaRepercutida: 12.35 }],
      CuotaTotal: 12.35,
      ImporteTotal: 123.45,
      Encadenamiento: {
        RegistroAnterior: {
          IDEmisorFactura: "89890001K",
          NumSerieFactura: "12345678/G33",
          FechaExpedicionFactura: "01-01-2024",
          Huella: record.Huella,
        },
      },
      SistemaInformatico: SISTEMA,
      generadoEn: new Date("2024-01-01T19:20:35+01:00"),
      offsetMinutes: 60,
    } satisfies AltaInput);
    const xml = serializeEnvio(CABECERA, [{ RegistroAlta: chained }]);
    expect(xml).toContain("<sf:RegistroAnterior>");
    expect(xml).toContain(`<sf:Huella>${record.Huella}</sf:Huella>`);
    expect(xml).not.toContain("PrimerRegistro");
  });

  it("serialises several records into one envio", () => {
    const xml = serializeEnvio(CABECERA, [{ RegistroAlta: record }, { RegistroAlta: record }]);
    expect(xml.match(/<sfLR:RegistroFactura>/g)).toHaveLength(2);
  });

  it("rejects a batch larger than the 1000-record cap", () => {
    // maxOccurs="1000" in the official XSD; exceeding it draws error 4113/4114.
    // The caller batches, but the library refuses to build an invalid envio.
    const many = Array.from({ length: 1001 }, () => ({ RegistroAlta: record }));
    expect(() => serializeEnvio(CABECERA, many)).toThrow(/1000/);
  });

  it("rejects an empty batch", () => {
    expect(() => serializeEnvio(CABECERA, [])).toThrow(/at least one/i);
  });

  it("escapes text content", () => {
    const withEntity = {
      ...record,
      NombreRazonEmisor: "Bar & Grill",
    };
    expect(serializeEnvio(CABECERA, [{ RegistroAlta: withEntity }])).toContain("Bar &amp; Grill");
  });
});

describe("serializeConsulta", () => {
  it("emits the mandatory PeriodoImputacion", () => {
    const xml = serializeConsulta(CABECERA, { Ejercicio: "2024", Periodo: "01" });
    expect(xml).toContain("<sfLRC:Ejercicio>2024</sfLRC:Ejercicio>");
    expect(xml).toContain("<sfLRC:Periodo>01</sfLRC:Periodo>");
  });

  it("includes an optional invoice identity filter when supplied", () => {
    const xml = serializeConsulta(CABECERA, {
      Ejercicio: "2024",
      Periodo: "01",
      NumSerieFactura: "12345678/G33",
    });
    expect(xml).toContain("<sfLRC:NumSerieFactura>12345678/G33</sfLRC:NumSerieFactura>");
  });

  it("includes ClavePaginacion when continuing a paged sweep", () => {
    const xml = serializeConsulta(CABECERA, {
      Ejercicio: "2024",
      Periodo: "01",
      ClavePaginacion: {
        IDEmisorFactura: "89890001K",
        NumSerieFactura: "12345678/G33",
        FechaExpedicionFactura: "01-01-2024",
      },
    });
    expect(xml).toContain("<sfLRC:ClavePaginacion>");
  });

  it("omits optional filters that were not supplied", () => {
    const xml = serializeConsulta(CABECERA, { Ejercicio: "2024", Periodo: "01" });
    expect(xml).not.toContain("NumSerieFactura");
    expect(xml).not.toContain("ClavePaginacion");
  });
});
```

- [ ] **Step 2: Run each test individually and watch it fail**

Expected: FAIL — unresolved imports.

- [ ] **Step 3: Implement the escaper**

`packages/verifactu/src/xml/escape.ts`:

```ts
/**
 * Escapes the five XML metacharacters.
 *
 * The ampersand must be replaced FIRST — doing it last would re-escape the
 * ampersands introduced by the other four, turning `<` into `&amp;lt;`.
 */
export function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
```

- [ ] **Step 4: Implement the serialiser**

`packages/verifactu/src/xml/serialize.ts`:

```ts
import { escapeXml } from "./escape.js";
import type {
  DetalleDesglose,
  Encadenamiento,
  RegistroAlta,
  RegistroAnulacion,
  SistemaInformatico,
} from "../types.js";

/** maxOccurs="1000" in the official XSD; exceeding it draws error 4113/4114. */
export const MAX_REGISTROS_POR_ENVIO = 1000;

const NS_SF = "https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroInformacion.xsd";
const NS_LR = "https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroLR.xsd";
const NS_LRC = "https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/ConsultaLR.xsd";
const NS_SOAP = "http://schemas.xmlsoap.org/soap/envelope/";

export interface Cabecera {
  ObligadoEmision: { NombreRazon: string; NIF: string };
  Representante?: { NombreRazon: string; NIF: string };
}

export type EnvioRegistro = { RegistroAlta: RegistroAlta } | { RegistroAnulacion: RegistroAnulacion };

export interface ConsultaFiltro {
  Ejercicio: string;
  Periodo: string;
  NumSerieFactura?: string;
  FechaExpedicionFactura?: string;
  ClavePaginacion?: {
    IDEmisorFactura: string;
    NumSerieFactura: string;
    FechaExpedicionFactura: string;
  };
}

function el(prefix: string, name: string, value: string | undefined): string {
  return value === undefined ? "" : `<${prefix}:${name}>${escapeXml(value)}</${prefix}:${name}>`;
}

function sistemaInformatico(sistema: SistemaInformatico): string {
  return (
    "<sf:SistemaInformatico>" +
    el("sf", "NombreRazon", sistema.NombreRazon) +
    el("sf", "NIF", sistema.NIF) +
    el("sf", "NombreSistemaInformatico", sistema.NombreSistemaInformatico) +
    el("sf", "IdSistemaInformatico", sistema.IdSistemaInformatico) +
    el("sf", "Version", sistema.Version) +
    el("sf", "NumeroInstalacion", sistema.NumeroInstalacion) +
    el("sf", "TipoUsoPosibleSoloVerifactu", sistema.TipoUsoPosibleSoloVerifactu) +
    el("sf", "TipoUsoPosibleMultiOT", sistema.TipoUsoPosibleMultiOT) +
    el("sf", "IndicadorMultiplesOT", sistema.IndicadorMultiplesOT) +
    "</sf:SistemaInformatico>"
  );
}

function encadenamiento(value: Encadenamiento): string {
  if ("PrimerRegistro" in value) {
    return "<sf:Encadenamiento><sf:PrimerRegistro>S</sf:PrimerRegistro></sf:Encadenamiento>";
  }
  const previous = value.RegistroAnterior;
  return (
    "<sf:Encadenamiento><sf:RegistroAnterior>" +
    el("sf", "IDEmisorFactura", previous.IDEmisorFactura) +
    el("sf", "NumSerieFactura", previous.NumSerieFactura) +
    el("sf", "FechaExpedicionFactura", previous.FechaExpedicionFactura) +
    el("sf", "Huella", previous.Huella) +
    "</sf:RegistroAnterior></sf:Encadenamiento>"
  );
}

function detalle(line: DetalleDesglose): string {
  return (
    "<sf:DetalleDesglose>" +
    el("sf", "Impuesto", line.Impuesto) +
    el("sf", "ClaveRegimen", line.ClaveRegimen) +
    el("sf", "CalificacionOperacion", line.CalificacionOperacion) +
    el("sf", "OperacionExenta", line.OperacionExenta) +
    el("sf", "TipoImpositivo", line.TipoImpositivo) +
    el("sf", "BaseImponibleOimporteNoSujeto", line.BaseImponibleOimporteNoSujeto) +
    el("sf", "BaseImponibleACoste", line.BaseImponibleACoste) +
    el("sf", "CuotaRepercutida", line.CuotaRepercutida) +
    el("sf", "TipoRecargoEquivalencia", line.TipoRecargoEquivalencia) +
    el("sf", "CuotaRecargoEquivalencia", line.CuotaRecargoEquivalencia) +
    "</sf:DetalleDesglose>"
  );
}

function registroAlta(record: RegistroAlta): string {
  return (
    "<sfLR:RegistroAlta>" +
    el("sf", "IDVersion", record.IDVersion) +
    "<sf:IDFactura>" +
    el("sf", "IDEmisorFactura", record.IDFactura.IDEmisorFactura) +
    el("sf", "NumSerieFactura", record.IDFactura.NumSerieFactura) +
    el("sf", "FechaExpedicionFactura", record.IDFactura.FechaExpedicionFactura) +
    "</sf:IDFactura>" +
    el("sf", "RefExterna", record.RefExterna) +
    el("sf", "NombreRazonEmisor", record.NombreRazonEmisor) +
    el("sf", "Subsanacion", record.Subsanacion) +
    el("sf", "RechazoPrevio", record.RechazoPrevio) +
    el("sf", "TipoFactura", record.TipoFactura) +
    el("sf", "TipoRectificativa", record.TipoRectificativa) +
    el("sf", "FechaOperacion", record.FechaOperacion) +
    el("sf", "DescripcionOperacion", record.DescripcionOperacion) +
    el("sf", "FacturaSimplificadaArt7273", record.FacturaSimplificadaArt7273) +
    el("sf", "FacturaSinIdentifDestinatarioArt61d", record.FacturaSinIdentifDestinatarioArt61d) +
    el("sf", "Macrodato", record.Macrodato) +
    el("sf", "Cupon", record.Cupon) +
    `<sf:Desglose>${record.Desglose.map(detalle).join("")}</sf:Desglose>` +
    el("sf", "CuotaTotal", record.CuotaTotal) +
    el("sf", "ImporteTotal", record.ImporteTotal) +
    encadenamiento(record.Encadenamiento) +
    sistemaInformatico(record.SistemaInformatico) +
    el("sf", "FechaHoraHusoGenRegistro", record.FechaHoraHusoGenRegistro) +
    el("sf", "TipoHuella", record.TipoHuella) +
    el("sf", "Huella", record.Huella) +
    "</sfLR:RegistroAlta>"
  );
}

function registroAnulacion(record: RegistroAnulacion): string {
  return (
    "<sfLR:RegistroAnulacion>" +
    el("sf", "IDVersion", record.IDVersion) +
    "<sf:IDFactura>" +
    el("sf", "IDEmisorFacturaAnulada", record.IDFactura.IDEmisorFacturaAnulada) +
    el("sf", "NumSerieFacturaAnulada", record.IDFactura.NumSerieFacturaAnulada) +
    el("sf", "FechaExpedicionFacturaAnulada", record.IDFactura.FechaExpedicionFacturaAnulada) +
    "</sf:IDFactura>" +
    el("sf", "RefExterna", record.RefExterna) +
    el("sf", "SinRegistroPrevio", record.SinRegistroPrevio) +
    el("sf", "RechazoPrevio", record.RechazoPrevio) +
    el("sf", "GeneradoPor", record.GeneradoPor) +
    encadenamiento(record.Encadenamiento) +
    sistemaInformatico(record.SistemaInformatico) +
    el("sf", "FechaHoraHusoGenRegistro", record.FechaHoraHusoGenRegistro) +
    el("sf", "TipoHuella", record.TipoHuella) +
    el("sf", "Huella", record.Huella) +
    "</sfLR:RegistroAnulacion>"
  );
}

function cabeceraXml(cabecera: Cabecera): string {
  return (
    "<sfLR:Cabecera>" +
    "<sf:ObligadoEmision>" +
    el("sf", "NombreRazon", cabecera.ObligadoEmision.NombreRazon) +
    el("sf", "NIF", cabecera.ObligadoEmision.NIF) +
    "</sf:ObligadoEmision>" +
    (cabecera.Representante
      ? "<sf:Representante>" +
        el("sf", "NombreRazon", cabecera.Representante.NombreRazon) +
        el("sf", "NIF", cabecera.Representante.NIF) +
        "</sf:Representante>"
      : "") +
    "</sfLR:Cabecera>"
  );
}

function envelope(body: string, extraNs: string): string {
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<soapenv:Envelope xmlns:soapenv="${NS_SOAP}" xmlns:sf="${NS_SF}" ${extraNs}>` +
    `<soapenv:Body>${body}</soapenv:Body>` +
    `</soapenv:Envelope>`
  );
}

/**
 * Serialises a submission. One Cabecera names the obligado tributario; each
 * record carries its own SistemaInformatico, so a single envio may cover
 * several SIFs of the same obligado — which is what lets one batch span
 * several tills.
 */
export function serializeEnvio(cabecera: Cabecera, registros: EnvioRegistro[]): string {
  if (registros.length === 0) {
    throw new Error("An envio must contain at least one registro");
  }
  if (registros.length > MAX_REGISTROS_POR_ENVIO) {
    throw new Error(
      `An envio may carry at most ${MAX_REGISTROS_POR_ENVIO} registros, received ${registros.length}`,
    );
  }
  const body =
    `<sfLR:RegFactuSistemaFacturacion>` +
    cabeceraXml(cabecera) +
    registros
      .map(
        (entry) =>
          "<sfLR:RegistroFactura>" +
          ("RegistroAlta" in entry
            ? registroAlta(entry.RegistroAlta)
            : registroAnulacion(entry.RegistroAnulacion)) +
          "</sfLR:RegistroFactura>",
      )
      .join("") +
    `</sfLR:RegFactuSistemaFacturacion>`;
  return envelope(body, `xmlns:sfLR="${NS_LR}"`);
}

/** Serialises a consulta. PeriodoImputacion is mandatory even for one invoice. */
export function serializeConsulta(cabecera: Cabecera, filtro: ConsultaFiltro): string {
  const body =
    `<sfLRC:ConsultaFactuSistemaFacturacion>` +
    "<sfLRC:Cabecera>" +
    "<sf:ObligadoEmision>" +
    el("sf", "NombreRazon", cabecera.ObligadoEmision.NombreRazon) +
    el("sf", "NIF", cabecera.ObligadoEmision.NIF) +
    "</sf:ObligadoEmision>" +
    "</sfLRC:Cabecera>" +
    "<sfLRC:FiltroConsulta>" +
    "<sfLRC:PeriodoImputacion>" +
    el("sfLRC", "Ejercicio", filtro.Ejercicio) +
    el("sfLRC", "Periodo", filtro.Periodo) +
    "</sfLRC:PeriodoImputacion>" +
    el("sfLRC", "NumSerieFactura", filtro.NumSerieFactura) +
    el("sfLRC", "FechaExpedicionFactura", filtro.FechaExpedicionFactura) +
    (filtro.ClavePaginacion
      ? "<sfLRC:ClavePaginacion>" +
        el("sfLRC", "IDEmisorFactura", filtro.ClavePaginacion.IDEmisorFactura) +
        el("sfLRC", "NumSerieFactura", filtro.ClavePaginacion.NumSerieFactura) +
        el("sfLRC", "FechaExpedicionFactura", filtro.ClavePaginacion.FechaExpedicionFactura) +
        "</sfLRC:ClavePaginacion>"
      : "") +
    "</sfLRC:FiltroConsulta>" +
    `</sfLRC:ConsultaFactuSistemaFacturacion>`;
  return envelope(body, `xmlns:sfLRC="${NS_LRC}"`);
}
```

> **Namespace URIs must be checked against the local `SuministroInformacion.xsd`, `SuministroLR.xsd` and `ConsultaLR.xsd` before this task is considered done.** They are transcribed above from the schema locations; confirm each `targetNamespace` matches exactly. A wrong namespace produces a SOAP fault, not a validation error, and is tedious to diagnose from the response.

- [ ] **Step 5: Run tests, then commit**

```bash
pnpm vitest run src/xml/serialize.test.ts
```

Expected: PASS, 16 tests.

```bash
git add packages/verifactu/src/xml
git commit -m "feat(verifactu): SOAP serialisation for envio and consulta

Records are emitted with their stored literals verbatim, so the huella AEAT
recomputes from the XML is the one we hashed. Any reformatting here would
silently invalidate every record.

The 1000-record cap is enforced when building rather than left to the
caller; an oversized envio is rejected locally instead of drawing 4113 from
AEAT."
```

---

## Task 8: Parse the submission response

Contains the single subtlest behaviour in the library: **error 3000 inverts**. The outer line reads `Incorrecto` while the duplicate block may report the stored record as `Correcta`. A naive reading marks an accepted record rejected and halts a healthy chain.

**Files:**

- Create: `packages/verifactu/src/xml/parse-suministro.ts`
- Create: `packages/verifactu/src/xml/parse-suministro.test.ts`

**Interfaces:**

- Consumes: `fast-xml-parser`.
- Produces: `parseRespuestaSuministro(xml: string): RespuestaSuministro`, `resolveEstadoEfectivo(linea: RespuestaLinea): EstadoEfectivo`, types `RespuestaSuministro`, `RespuestaLinea`, `EstadoEnvio`, `EstadoRegistroSuministro`, `RegistroDuplicado`, `EstadoEfectivo`.

- [ ] **Step 1: Write the failing tests**

`packages/verifactu/src/xml/parse-suministro.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseRespuestaSuministro, resolveEstadoEfectivo } from "./parse-suministro.js";

const envelope = (body: string) =>
  `<?xml version="1.0" encoding="UTF-8"?>
   <soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
     <soapenv:Body>
       <RespuestaRegFactuSistemaFacturacion>${body}</RespuestaRegFactuSistemaFacturacion>
     </soapenv:Body>
   </soapenv:Envelope>`;

const ACCEPTED = envelope(`
  <CSV>ABC123CSV</CSV>
  <DatosPresentacion><NIFPresentador>89890001K</NIFPresentador>
    <TimestampPresentacion>01-01-2024 19:20:30</TimestampPresentacion></DatosPresentacion>
  <EstadoEnvio>Correcto</EstadoEnvio>
  <TiempoEsperaEnvio>60</TiempoEsperaEnvio>
  <RespuestaLinea>
    <IDFactura><IDEmisorFactura>89890001K</IDEmisorFactura>
      <NumSerieFactura>12345678/G33</NumSerieFactura>
      <FechaExpedicionFactura>01-01-2024</FechaExpedicionFactura></IDFactura>
    <EstadoRegistro>Correcto</EstadoRegistro>
  </RespuestaLinea>`);

const DUPLICATE_BUT_ACCEPTED = envelope(`
  <EstadoEnvio>Incorrecto</EstadoEnvio>
  <TiempoEsperaEnvio>60</TiempoEsperaEnvio>
  <RespuestaLinea>
    <IDFactura><IDEmisorFactura>89890001K</IDEmisorFactura>
      <NumSerieFactura>12345678/G33</NumSerieFactura>
      <FechaExpedicionFactura>01-01-2024</FechaExpedicionFactura></IDFactura>
    <EstadoRegistro>Incorrecto</EstadoRegistro>
    <CodigoErrorRegistro>3000</CodigoErrorRegistro>
    <DescripcionErrorRegistro>Registro de facturacion duplicado.</DescripcionErrorRegistro>
    <RegistroDuplicado>
      <IdPeticionRegistroDuplicado>PET-1</IdPeticionRegistroDuplicado>
      <EstadoRegistroDuplicado>Correcta</EstadoRegistroDuplicado>
    </RegistroDuplicado>
  </RespuestaLinea>`);

describe("parseRespuestaSuministro", () => {
  it("extracts the envelope status and wait time", () => {
    const response = parseRespuestaSuministro(ACCEPTED);
    expect(response.EstadoEnvio).toBe("Correcto");
    expect(response.TiempoEsperaEnvio).toBe(60);
  });

  it("returns TiempoEsperaEnvio as a number", () => {
    expect(typeof parseRespuestaSuministro(ACCEPTED).TiempoEsperaEnvio).toBe("number");
  });

  it("round-trips a four-digit wait time", () => {
    // The schema permits \d{0,4}, so up to 9999. Any 8-bit storage overflows
    // silently above 255.
    const xml = ACCEPTED.replace("<TiempoEsperaEnvio>60<", "<TiempoEsperaEnvio>9999<");
    expect(parseRespuestaSuministro(xml).TiempoEsperaEnvio).toBe(9999);
  });

  it("extracts the CSV when the envio was accepted", () => {
    expect(parseRespuestaSuministro(ACCEPTED).CSV).toBe("ABC123CSV");
  });

  it("leaves CSV undefined when absent", () => {
    // The CSV is only generated when the envio is not rejected, and it can
    // never be retrieved later — the caller must persist it on receipt.
    expect(parseRespuestaSuministro(DUPLICATE_BUT_ACCEPTED).CSV).toBeUndefined();
  });

  it("parses the per-record lines with their invoice identity", () => {
    const [linea] = parseRespuestaSuministro(ACCEPTED).RespuestaLinea;
    expect(linea?.IDFactura.NumSerieFactura).toBe("12345678/G33");
    expect(linea?.EstadoRegistro).toBe("Correcto");
  });

  it("normalises a single line into an array", () => {
    // fast-xml-parser collapses a lone repeated element into an object; a
    // caller iterating the result would otherwise break on single-record
    // envios, which is the common case for a quiet till.
    expect(Array.isArray(parseRespuestaSuministro(ACCEPTED).RespuestaLinea)).toBe(true);
  });

  it("parses the RegistroDuplicado block on a 3000", () => {
    const [linea] = parseRespuestaSuministro(DUPLICATE_BUT_ACCEPTED).RespuestaLinea;
    expect(linea?.CodigoErrorRegistro).toBe(3000);
    expect(linea?.RegistroDuplicado?.EstadoRegistroDuplicado).toBe("Correcta");
  });
});

describe("resolveEstadoEfectivo", () => {
  it("reports an accepted record as accepted", () => {
    const [linea] = parseRespuestaSuministro(ACCEPTED).RespuestaLinea;
    expect(resolveEstadoEfectivo(linea!)).toBe("accepted");
  });

  it("reports a 3000 whose stored record is Correcta as ACCEPTED, not rejected", () => {
    // The outer EstadoRegistro reads Incorrecto. Trusting it would mark an
    // accepted record rejected and halt a healthy chain — the exact inversion
    // this function exists to prevent.
    const [linea] = parseRespuestaSuministro(DUPLICATE_BUT_ACCEPTED).RespuestaLinea;
    expect(linea?.EstadoRegistro).toBe("Incorrecto");
    expect(resolveEstadoEfectivo(linea!)).toBe("accepted");
  });

  it("reports a 3000 whose stored record is AceptadaConErrores as accepted-with-errors", () => {
    const xml = DUPLICATE_BUT_ACCEPTED.replace(
      "<EstadoRegistroDuplicado>Correcta<",
      "<EstadoRegistroDuplicado>AceptadaConErrores<",
    );
    const [linea] = parseRespuestaSuministro(xml).RespuestaLinea;
    expect(resolveEstadoEfectivo(linea!)).toBe("accepted_with_errors");
  });

  it("reports a 3000 whose stored record is Anulada as needing attention", () => {
    const xml = DUPLICATE_BUT_ACCEPTED.replace(
      "<EstadoRegistroDuplicado>Correcta<",
      "<EstadoRegistroDuplicado>Anulada<",
    );
    const [linea] = parseRespuestaSuministro(xml).RespuestaLinea;
    expect(resolveEstadoEfectivo(linea!)).toBe("duplicate_annulled");
  });

  it("reports a genuine rejection as rejected", () => {
    const xml = DUPLICATE_BUT_ACCEPTED.replace("<CodigoErrorRegistro>3000<", "<CodigoErrorRegistro>1180<")
      .replace(/<RegistroDuplicado>[\s\S]*<\/RegistroDuplicado>/, "");
    const [linea] = parseRespuestaSuministro(xml).RespuestaLinea;
    expect(resolveEstadoEfectivo(linea!)).toBe("rejected");
  });

  it("reports a 3000 with no duplicate block as needing a consulta", () => {
    const xml = DUPLICATE_BUT_ACCEPTED.replace(/<RegistroDuplicado>[\s\S]*<\/RegistroDuplicado>/, "");
    const [linea] = parseRespuestaSuministro(xml).RespuestaLinea;
    expect(resolveEstadoEfectivo(linea!)).toBe("duplicate_unknown");
  });
});
```

- [ ] **Step 2: Run each test individually and watch it fail**

Expected: FAIL — unresolved import. Confirm especially that the two inversion tests fail before the implementation exists.

- [ ] **Step 3: Implement**

`packages/verifactu/src/xml/parse-suministro.ts`:

```ts
import { XMLParser } from "fast-xml-parser";

export type EstadoEnvio = "Correcto" | "ParcialmenteCorrecto" | "Incorrecto";
export type EstadoRegistroSuministro = "Correcto" | "AceptadoConErrores" | "Incorrecto";
/** Consulta uses a DIFFERENT enum. Never share this type with that path. */
export type EstadoRegistroDuplicado = "Correcta" | "AceptadaConErrores" | "Anulada";

export interface RegistroDuplicado {
  IdPeticionRegistroDuplicado?: string;
  EstadoRegistroDuplicado?: EstadoRegistroDuplicado;
  CodigoErrorRegistro?: number;
  DescripcionErrorRegistro?: string;
}

export interface RespuestaLinea {
  IDFactura: {
    IDEmisorFactura: string;
    NumSerieFactura: string;
    FechaExpedicionFactura: string;
  };
  Operacion?: string;
  RefExterna?: string;
  EstadoRegistro: EstadoRegistroSuministro;
  CodigoErrorRegistro?: number;
  DescripcionErrorRegistro?: string;
  RegistroDuplicado?: RegistroDuplicado;
}

export interface RespuestaSuministro {
  CSV?: string;
  EstadoEnvio: EstadoEnvio;
  TiempoEsperaEnvio: number;
  RespuestaLinea: RespuestaLinea[];
}

/** What the caller should actually record, after resolving the 3000 inversion. */
export type EstadoEfectivo =
  | "accepted"
  | "accepted_with_errors"
  | "rejected"
  | "duplicate_annulled"
  | "duplicate_unknown";

export const ERROR_DUPLICADO = 3000;

const parser = new XMLParser({
  ignoreAttributes: true,
  // Strip namespace prefixes so `sfR:EstadoEnvio` and `EstadoEnvio` both land
  // on the same key — AEAT's prefixes are not guaranteed stable across
  // environments, and binding to them would make the parser brittle.
  removeNSPrefix: true,
  parseTagValue: false,
  trimValues: true,
});

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function asNumber(value: string | undefined): number | undefined {
  return value === undefined ? undefined : Number(value);
}

export function parseRespuestaSuministro(xml: string): RespuestaSuministro {
  const parsed = parser.parse(xml) as Record<string, any>;
  const body = parsed?.Envelope?.Body?.RespuestaRegFactuSistemaFacturacion;
  if (!body) {
    throw new Error("Response does not contain RespuestaRegFactuSistemaFacturacion");
  }
  return {
    CSV: body.CSV,
    EstadoEnvio: body.EstadoEnvio as EstadoEnvio,
    // \d{0,4} in the schema, so up to 9999 — never narrow this to 8 bits.
    TiempoEsperaEnvio: Number(body.TiempoEsperaEnvio),
    RespuestaLinea: asArray(body.RespuestaLinea).map((linea: Record<string, any>) => ({
      IDFactura: {
        IDEmisorFactura: linea.IDFactura?.IDEmisorFactura,
        NumSerieFactura: linea.IDFactura?.NumSerieFactura,
        FechaExpedicionFactura: linea.IDFactura?.FechaExpedicionFactura,
      },
      Operacion: linea.Operacion,
      RefExterna: linea.RefExterna,
      EstadoRegistro: linea.EstadoRegistro as EstadoRegistroSuministro,
      CodigoErrorRegistro: asNumber(linea.CodigoErrorRegistro),
      DescripcionErrorRegistro: linea.DescripcionErrorRegistro,
      RegistroDuplicado: linea.RegistroDuplicado
        ? {
            IdPeticionRegistroDuplicado: linea.RegistroDuplicado.IdPeticionRegistroDuplicado,
            EstadoRegistroDuplicado: linea.RegistroDuplicado
              .EstadoRegistroDuplicado as EstadoRegistroDuplicado,
            CodigoErrorRegistro: asNumber(linea.RegistroDuplicado.CodigoErrorRegistro),
            DescripcionErrorRegistro: linea.RegistroDuplicado.DescripcionErrorRegistro,
          }
        : undefined,
    })),
  };
}

/**
 * Resolves what a response line actually means.
 *
 * Error 3000 inverts: the outer EstadoRegistro reads `Incorrecto`, but the
 * RegistroDuplicado block may report the ALREADY-STORED record as `Correcta`.
 * Reading the outer status as authoritative would mark an accepted record
 * rejected and halt a healthy chain — the opposite of the truth.
 *
 * `duplicate_unknown` means AEAT holds something under this identity but did
 * not say what; the caller must resolve it with a consulta and compare the
 * stored huella. `duplicate_annulled` means AEAT holds an annulled record
 * there, which needs attention rather than a retry.
 */
export function resolveEstadoEfectivo(linea: RespuestaLinea): EstadoEfectivo {
  if (linea.CodigoErrorRegistro === ERROR_DUPLICADO) {
    switch (linea.RegistroDuplicado?.EstadoRegistroDuplicado) {
      case "Correcta":
        return "accepted";
      case "AceptadaConErrores":
        return "accepted_with_errors";
      case "Anulada":
        return "duplicate_annulled";
      default:
        return "duplicate_unknown";
    }
  }
  switch (linea.EstadoRegistro) {
    case "Correcto":
      return "accepted";
    case "AceptadoConErrores":
      return "accepted_with_errors";
    default:
      return "rejected";
  }
}
```

- [ ] **Step 4: Run tests, verify mutation, commit**

```bash
pnpm vitest run src/xml/parse-suministro.test.ts
pnpm mutation
```

Expected: PASS, 14 tests; mutation score ≥ 90 with no survivors in the `resolveEstadoEfectivo` switch.

```bash
git add packages/verifactu/src/xml
git commit -m "feat(verifactu): parse submission responses, resolving the 3000 inversion

Error 3000 inverts: the outer EstadoRegistro reads Incorrecto while the
RegistroDuplicado block may report the already-stored record as Correcta.
Trusting the outer status would mark an accepted record rejected and halt a
healthy chain.

TiempoEsperaEnvio is parsed as a number and tested at 9999, the schema's
maximum — an 8-bit field overflows silently above 255.

A lone RespuestaLinea is normalised into an array, because the parser
collapses single repeated elements and a quiet till submits one record at a
time."
```

---

## Task 9: Parse the consulta response

**Files:**

- Create: `packages/verifactu/src/xml/parse-consulta.ts`
- Create: `packages/verifactu/src/xml/parse-consulta.test.ts`

**Interfaces:**

- Produces: `parseRespuestaConsulta(xml: string): RespuestaConsulta`, types `RespuestaConsulta`, `RegistroConsultado`, `EstadoRegistroConsulta`.

- [ ] **Step 1: Write the failing tests**

`packages/verifactu/src/xml/parse-consulta.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseRespuestaConsulta } from "./parse-consulta.js";

const RESPONSE = `<?xml version="1.0" encoding="UTF-8"?>
  <soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
    <soapenv:Body>
      <RespuestaConsultaFactuSistemaFacturacion>
        <ResultadoConsulta>ConDatos</ResultadoConsulta>
        <IndicadorPaginacion>N</IndicadorPaginacion>
        <RegistroRespuestaConsultaFactuSistemaFacturacion>
          <IDFactura><IDEmisorFactura>89890001K</IDEmisorFactura>
            <NumSerieFactura>12345678/G33</NumSerieFactura>
            <FechaExpedicionFactura>01-01-2024</FechaExpedicionFactura></IDFactura>
          <DatosRegistroFacturacion>
            <ImporteTotal>123.45</ImporteTotal>
            <CuotaTotal>12.35</CuotaTotal>
            <Huella>3C464DAF61ACB827C65FDA19F352A4E3BDC2C640E9E9FC4CC058073F38F12F60</Huella>
            <TipoHuella>01</TipoHuella>
          </DatosRegistroFacturacion>
          <EstadoRegistro><EstadoRegistro>Correcta</EstadoRegistro></EstadoRegistro>
        </RegistroRespuestaConsultaFactuSistemaFacturacion>
      </RespuestaConsultaFactuSistemaFacturacion>
    </soapenv:Body>
  </soapenv:Envelope>`;

describe("parseRespuestaConsulta", () => {
  it("reports whether the query returned data", () => {
    expect(parseRespuestaConsulta(RESPONSE).ResultadoConsulta).toBe("ConDatos");
  });

  it("returns the stored huella so it can be compared field-free", () => {
    // Comparing the stored huella is a single-field check equivalent to
    // diffing every hashed field, which is why the 3000 resolution uses it.
    const [registro] = parseRespuestaConsulta(RESPONSE).registros;
    expect(registro?.DatosRegistroFacturacion.Huella).toBe(
      "3C464DAF61ACB827C65FDA19F352A4E3BDC2C640E9E9FC4CC058073F38F12F60",
    );
  });

  it("uses the consulta enum, which has Anulada and no Incorrecta", () => {
    const [registro] = parseRespuestaConsulta(RESPONSE).registros;
    expect(registro?.EstadoRegistro).toBe("Correcta");
    const annulled = RESPONSE.replace(
      "<EstadoRegistro>Correcta</EstadoRegistro>",
      "<EstadoRegistro>Anulada</EstadoRegistro>",
    );
    expect(parseRespuestaConsulta(annulled).registros[0]?.EstadoRegistro).toBe("Anulada");
  });

  it("exposes no CSV field at all", () => {
    // The CSV exists only in the submission response and can never be
    // retrieved later. A csv property here would be permanently undefined and
    // would invite exactly the bug it looks like it solves.
    const [registro] = parseRespuestaConsulta(RESPONSE).registros;
    expect(registro).not.toHaveProperty("CSV");
    expect(parseRespuestaConsulta(RESPONSE)).not.toHaveProperty("CSV");
  });

  it("reports no further pages when IndicadorPaginacion is N", () => {
    expect(parseRespuestaConsulta(RESPONSE).IndicadorPaginacion).toBe("N");
    expect(parseRespuestaConsulta(RESPONSE).ClavePaginacion).toBeUndefined();
  });

  it("returns an empty list when the query found nothing", () => {
    const empty = RESPONSE.replace("ConDatos", "SinDatos").replace(
      /<RegistroRespuestaConsultaFactuSistemaFacturacion>[\s\S]*<\/RegistroRespuestaConsultaFactuSistemaFacturacion>/,
      "",
    );
    const response = parseRespuestaConsulta(empty);
    expect(response.ResultadoConsulta).toBe("SinDatos");
    expect(response.registros).toEqual([]);
  });
});
```

- [ ] **Step 2: Run each test individually and watch it fail**

Expected: FAIL — unresolved import.

- [ ] **Step 3: Implement**

`packages/verifactu/src/xml/parse-consulta.ts`:

```ts
import { XMLParser } from "fast-xml-parser";

/**
 * The consulta enum. Deliberately NOT shared with the submission response's
 * EstadoRegistroSuministro:
 *
 *   - No `Incorrecta`, because rejected records are never stored — AEAT: "ese
 *     RF rechazado no figuraria jamas en los sistemas de la AEAT".
 *   - Has `Anulada`, which submission never returns.
 *   - Feminine forms throughout.
 *
 * A shared type would model states that cannot occur on one side and miss
 * states that can on the other.
 */
export type EstadoRegistroConsulta = "Correcta" | "AceptadaConErrores" | "Anulada";

export interface RegistroConsultado {
  IDFactura: {
    IDEmisorFactura: string;
    NumSerieFactura: string;
    FechaExpedicionFactura: string;
  };
  /** The full stored record as AEAT holds it, including its huella. */
  DatosRegistroFacturacion: Record<string, unknown> & { Huella?: string; TipoHuella?: string };
  EstadoRegistro: EstadoRegistroConsulta;
  CodigoErrorRegistro?: number;
  DescripcionErrorRegistro?: string;
  DatosPresentacion?: {
    NIFPresentador?: string;
    TimestampPresentacion?: string;
    IdPeticion?: string;
  };
}

export interface RespuestaConsulta {
  ResultadoConsulta: "ConDatos" | "SinDatos";
  IndicadorPaginacion: "S" | "N";
  /** Echo into the next request to continue a paged sweep. Max 10 000 per page. */
  ClavePaginacion?: {
    IDEmisorFactura: string;
    NumSerieFactura: string;
    FechaExpedicionFactura: string;
  };
  registros: RegistroConsultado[];
}

const parser = new XMLParser({
  ignoreAttributes: true,
  removeNSPrefix: true,
  parseTagValue: false,
  trimValues: true,
});

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined || value === "") return [];
  return Array.isArray(value) ? value : [value];
}

export function parseRespuestaConsulta(xml: string): RespuestaConsulta {
  const parsed = parser.parse(xml) as Record<string, any>;
  const body = parsed?.Envelope?.Body?.RespuestaConsultaFactuSistemaFacturacion;
  if (!body) {
    throw new Error("Response does not contain RespuestaConsultaFactuSistemaFacturacion");
  }
  return {
    ResultadoConsulta: body.ResultadoConsulta,
    IndicadorPaginacion: body.IndicadorPaginacion,
    ClavePaginacion: body.ClavePaginacion
      ? {
          IDEmisorFactura: body.ClavePaginacion.IDEmisorFactura,
          NumSerieFactura: body.ClavePaginacion.NumSerieFactura,
          FechaExpedicionFactura: body.ClavePaginacion.FechaExpedicionFactura,
        }
      : undefined,
    registros: asArray(body.RegistroRespuestaConsultaFactuSistemaFacturacion).map(
      (registro: Record<string, any>) => ({
        IDFactura: {
          IDEmisorFactura: registro.IDFactura?.IDEmisorFactura,
          NumSerieFactura: registro.IDFactura?.NumSerieFactura,
          FechaExpedicionFactura: registro.IDFactura?.FechaExpedicionFactura,
        },
        DatosRegistroFacturacion: registro.DatosRegistroFacturacion ?? {},
        EstadoRegistro: registro.EstadoRegistro?.EstadoRegistro as EstadoRegistroConsulta,
        CodigoErrorRegistro:
          registro.EstadoRegistro?.CodigoErrorRegistro === undefined
            ? undefined
            : Number(registro.EstadoRegistro.CodigoErrorRegistro),
        DescripcionErrorRegistro: registro.EstadoRegistro?.DescripcionErrorRegistro,
        DatosPresentacion: registro.DatosPresentacion,
      }),
    ),
  };
}
```

- [ ] **Step 4: Run tests and commit**

```bash
pnpm vitest run src/xml/parse-consulta.test.ts
```

Expected: PASS, 6 tests.

```bash
git add packages/verifactu/src/xml
git commit -m "feat(verifactu): parse consulta responses

A separate enum from the submission path, and deliberately so: consulta has
Anulada and no Incorrecta, because rejected records are never stored. A
shared type would model impossible states on one side and miss real ones on
the other.

There is no CSV property, tested explicitly. The CSV exists only in the
submission response and can never be retrieved later, so a field here would
be permanently undefined while looking like the answer."
```

---

## Task 10: The SOAP client

**Files:**

- Create: `packages/verifactu/src/client.ts`
- Create: `packages/verifactu/src/client.test.ts`

**Interfaces:**

- Consumes: serialisers, parsers, endpoints.
- Produces: `createClient(options: ClientOptions): VerifactuClient` with `submit(cabecera, registros)` and `consultar(cabecera, filtro)`; types `ClientOptions`, `VerifactuClient`.

- [ ] **Step 1: Write the failing tests**

`packages/verifactu/src/client.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { createClient } from "./client.js";

const CABECERA = { ObligadoEmision: { NombreRazon: "Waitron SL", NIF: "89890001K" } };

const OK = `<?xml version="1.0"?>
  <soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Body>
    <RespuestaRegFactuSistemaFacturacion>
      <EstadoEnvio>Correcto</EstadoEnvio><TiempoEsperaEnvio>60</TiempoEsperaEnvio>
    </RespuestaRegFactuSistemaFacturacion></soapenv:Body></soapenv:Envelope>`;

function fakeFetch(body: string, init: { status?: number } = {}) {
  return vi.fn(async () => new Response(body, { status: init.status ?? 200 }));
}

describe("createClient", () => {
  it("posts to the configured endpoint", async () => {
    const fetch = fakeFetch(OK);
    const client = createClient({ endpoint: "https://example.test/soap", fetch });
    await client.submit(CABECERA, []);
    expect(fetch.mock.calls[0]?.[0]).toBe("https://example.test/soap");
  });

  it("sends an empty SOAPAction header", async () => {
    // The WSDL declares soapAction="" for every operation; dispatch is by
    // message body. Sending an operation name here is a guess, not a contract.
    const fetch = fakeFetch(OK);
    const client = createClient({ endpoint: "https://example.test/soap", fetch });
    await client.submit(CABECERA, []);
    const init = fetch.mock.calls[0]?.[1] as RequestInit;
    expect((init.headers as Record<string, string>)["SOAPAction"]).toBe('""');
  });

  it("sends the XML as the request body with a SOAP content type", async () => {
    const fetch = fakeFetch(OK);
    const client = createClient({ endpoint: "https://example.test/soap", fetch });
    await client.submit(CABECERA, []);
    const init = fetch.mock.calls[0]?.[1] as RequestInit;
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["Content-Type"]).toContain("text/xml");
    expect(String(init.body)).toContain("RegFactuSistemaFacturacion");
  });

  it("returns the parsed response", async () => {
    const client = createClient({ endpoint: "https://example.test/soap", fetch: fakeFetch(OK) });
    const response = await client.submit(CABECERA, []);
    expect(response.EstadoEnvio).toBe("Correcto");
    expect(response.TiempoEsperaEnvio).toBe(60);
  });

  it("throws with the status code on a transport failure", async () => {
    const client = createClient({
      endpoint: "https://example.test/soap",
      fetch: fakeFetch("upstream exploded", { status: 503 }),
    });
    await expect(client.submit(CABECERA, [])).rejects.toThrow(/503/);
  });

  it("uses the injected fetch rather than a global", async () => {
    // Injection is what makes the client runtime-agnostic and testable
    // without a network. If it ever reached for globalThis.fetch this would
    // still pass unless asserted directly.
    const fetch = fakeFetch(OK);
    const client = createClient({ endpoint: "https://example.test/soap", fetch });
    await client.submit(CABECERA, []);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("posts a consulta to the same endpoint", async () => {
    const fetch = fakeFetch(`<?xml version="1.0"?>
      <soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Body>
        <RespuestaConsultaFactuSistemaFacturacion>
          <ResultadoConsulta>SinDatos</ResultadoConsulta>
          <IndicadorPaginacion>N</IndicadorPaginacion>
        </RespuestaConsultaFactuSistemaFacturacion></soapenv:Body></soapenv:Envelope>`);
    const client = createClient({ endpoint: "https://example.test/soap", fetch });
    const response = await client.consultar(CABECERA, { Ejercicio: "2024", Periodo: "01" });
    expect(response.ResultadoConsulta).toBe("SinDatos");
    expect(fetch.mock.calls[0]?.[0]).toBe("https://example.test/soap");
  });
});
```

> `submit` with an empty array is used here only to exercise transport wiring; `serializeEnvio` rejects an empty batch, so the client must serialise lazily or these tests must pass one record. **Resolve this when implementing: pass a single record in the transport tests rather than weakening the cap check.**

- [ ] **Step 2: Run each test individually and watch it fail**

Expected: FAIL — unresolved import `./client.js`.

- [ ] **Step 3: Implement**

`packages/verifactu/src/client.ts`:

```ts
import { parseRespuestaConsulta, type RespuestaConsulta } from "./xml/parse-consulta.js";
import { parseRespuestaSuministro, type RespuestaSuministro } from "./xml/parse-suministro.js";
import {
  serializeConsulta,
  serializeEnvio,
  type Cabecera,
  type ConsultaFiltro,
  type EnvioRegistro,
} from "./xml/serialize.js";

export interface ClientOptions {
  endpoint: string;
  /**
   * Injected so the library is runtime-agnostic and testable without a
   * network. Client-certificate material is supplied by the caller's fetch
   * implementation — in Node that means an Agent/Dispatcher configured with
   * the cert and key. Keeping mTLS configuration outside this library is
   * deliberate: certificate handling is a deployment concern, and the spec
   * requires the submitter to be an interface rather than a location.
   */
  fetch: typeof globalThis.fetch;
}

export interface VerifactuClient {
  submit(cabecera: Cabecera, registros: EnvioRegistro[]): Promise<RespuestaSuministro>;
  consultar(cabecera: Cabecera, filtro: ConsultaFiltro): Promise<RespuestaConsulta>;
}

async function post(options: ClientOptions, xml: string): Promise<string> {
  const response = await options.fetch(options.endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "text/xml; charset=utf-8",
      // The WSDL declares soapAction="" on every operation; dispatch is by
      // message body, not by this header.
      SOAPAction: '""',
    },
    body: xml,
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`AEAT request failed with HTTP ${response.status}: ${text.slice(0, 500)}`);
  }
  return text;
}

export function createClient(options: ClientOptions): VerifactuClient {
  return {
    async submit(cabecera, registros) {
      return parseRespuestaSuministro(await post(options, serializeEnvio(cabecera, registros)));
    },
    async consultar(cabecera, filtro) {
      return parseRespuestaConsulta(await post(options, serializeConsulta(cabecera, filtro)));
    },
  };
}
```

- [ ] **Step 4: Run tests and commit**

```bash
pnpm vitest run src/client.test.ts
```

Expected: PASS, 7 tests.

```bash
git add packages/verifactu/src
git commit -m "feat(verifactu): SOAP client over an injected fetch

fetch is injected rather than reached for globally, which keeps the library
runtime-agnostic and testable without a network. mTLS certificate material
stays with the caller's fetch implementation: certificate handling is a
deployment concern, and the design requires the submitter to be an interface
rather than a location.

SOAPAction is sent empty per the WSDL — dispatch is by message body."
```

---

## Task 11: Public surface, conformance suite and README

**Files:**

- Modify: `packages/verifactu/src/index.ts`
- Create: `packages/verifactu/src/conformance.test.ts`
- Create: `packages/verifactu/README.md`

- [ ] **Step 1: Complete the public surface**

`packages/verifactu/src/index.ts`:

```ts
// The entire public surface of @waitron/verifactu. Re-exports only — no logic here.
export { formatAmount, formatDate, formatDateTime, trimValue } from "./format.js";
export {
  buildCadena,
  buildCadenaAlta,
  buildCadenaAnulacion,
  computeHuella,
  huellaAnteriorOf,
  verifyHuella,
} from "./huella.js";
export { buildAltaRecord, buildAnulacionRecord } from "./records.js";
export { validate } from "./validate.js";
export { buildQrPayload } from "./qr.js";
export { QR_ENDPOINTS, SOAP_ENDPOINTS, SOAP_ENDPOINTS_SELLO } from "./endpoints.js";
export { MAX_REGISTROS_POR_ENVIO, serializeConsulta, serializeEnvio } from "./xml/serialize.js";
export {
  ERROR_DUPLICADO,
  parseRespuestaSuministro,
  resolveEstadoEfectivo,
} from "./xml/parse-suministro.js";
export { parseRespuestaConsulta } from "./xml/parse-consulta.js";
export { createClient } from "./client.js";

export type * from "./types.js";
export type { Environment } from "./endpoints.js";
export type { ValidationIssue, ValidationSeverity } from "./validate.js";
export type { Cabecera, ConsultaFiltro, EnvioRegistro } from "./xml/serialize.js";
export type {
  EstadoEfectivo,
  EstadoEnvio,
  EstadoRegistroDuplicado,
  EstadoRegistroSuministro,
  RegistroDuplicado,
  RespuestaLinea,
  RespuestaSuministro,
} from "./xml/parse-suministro.js";
export type {
  EstadoRegistroConsulta,
  RegistroConsultado,
  RespuestaConsulta,
} from "./xml/parse-consulta.js";
export type { ClientOptions, VerifactuClient } from "./client.js";
```

- [ ] **Step 2: Add the conformance suite**

`packages/verifactu/src/conformance.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  VECTOR_1_CADENA,
  VECTOR_1_HUELLA,
  VECTOR_1_INPUT,
  VECTOR_2_HUELLA,
  VECTOR_2_INPUT,
  VECTOR_3_CADENA,
  VECTOR_3_HUELLA,
  VECTOR_3_INPUT,
} from "../test/vectors.js";
import { buildCadenaAlta, buildCadenaAnulacion } from "./huella.js";
import { createHash } from "node:crypto";

/**
 * AEAT conformance. These are the authority's own published worked examples,
 * and they are the closest thing to ground truth available before
 * preproduction access exists. If one fails, the implementation is wrong —
 * never adjust a vector to match the code.
 */
describe("AEAT conformance vectors", () => {
  const hash = (cadena: string) =>
    createHash("sha256").update(cadena, "utf8").digest("hex").toUpperCase();

  it("vector 1 canonical string matches the published text", () => {
    expect(buildCadenaAlta(VECTOR_1_INPUT)).toBe(VECTOR_1_CADENA);
  });

  it("vector 1 hashes to the published huella", () => {
    expect(hash(VECTOR_1_CADENA)).toBe(VECTOR_1_HUELLA);
  });

  it("vector 2 hashes to the published huella", () => {
    expect(hash(buildCadenaAlta(VECTOR_2_INPUT))).toBe(VECTOR_2_HUELLA);
  });

  it("vector 3 canonical string matches the published text", () => {
    expect(buildCadenaAnulacion(VECTOR_3_INPUT)).toBe(VECTOR_3_CADENA);
  });

  it("vector 3 hashes to the published huella", () => {
    expect(hash(VECTOR_3_CADENA)).toBe(VECTOR_3_HUELLA);
  });
});
```

> **Follow-up, not part of this task:** wire `borjamrd/verifactu-conformance` (MIT) in as a dev dependency and run its full fixture set, which mirrors these vectors and adds more. It is rated the most valuable external asset in the provenance document. Deferred here only because the three vectors above are the ones AEAT publishes as normative text, and they gate correctness on their own.

- [ ] **Step 3: Write the README**

`packages/verifactu/README.md`:

````markdown
# @waitron/verifactu

TypeScript implementation of Spain's Veri\*Factu invoicing records: construction, hashing,
chaining, validation, QR payloads, SOAP submission and consulta.

> **This library is a tool for building SIFs. It is not itself a SIF.**
> A _sistema informático de facturación_ is a deployed system, and its obligations —
> conservation, inalterability and accessibility of records — are properties of a deployment,
> not of source code. Each deploying business issues its own declaración responsable for its own
> installation. See [`PROVENANCE.md`](./PROVENANCE.md).

## Design

Pure and stateless. Every export is a function over plain data. There is no database, no
persistence, no ambient state and no I/O except through an injected `fetch`. Chain state,
ordering, retries and storage belong to the caller — chain append has to join the host's
transaction, which a stateful library could not do.

Types mirror AEAT's schema names exactly (`RegistroAlta`, `Encadenamiento`, `DetalleDesglose`);
functions are named in English.

## Usage

```ts
import { buildAltaRecord, buildQrPayload, createClient, validate } from "@waitron/verifactu";

const record = buildAltaRecord({
  IDEmisorFactura: "89890001K",
  NumSerieFactura: "T01/000123",
  FechaExpedicionFactura: new Date(),
  NombreRazonEmisor: "Example SL",
  TipoFactura: "F2",
  DescripcionOperacion: "Venta en establecimiento",
  Desglose: [{ BaseImponibleOimporteNoSujeto: 10, CuotaRepercutida: 2.1, TipoImpositivo: 21 }],
  CuotaTotal: 2.1,
  ImporteTotal: 12.1,
  Encadenamiento: { PrimerRegistro: "S" },
  SistemaInformatico: sistema,
  generadoEn: new Date(),
  offsetMinutes: 120,
});

const issues = validate(record);
const qr = buildQrPayload(record, "production");
```

## The rule that matters most

**Serialise once, hash that exact literal.** AEAT recomputes the huella from the literal it
received, so `123.1` and `123.10` are both valid and hash differently. Records carry
pre-formatted strings for exactly this reason — never reformat a value between building a record
and serialising it.

## Licence

Source-available under the Elastic License 2.0, with additional permissions. See `LICENSE` and
`LICENSE-GRANTS.md` at the repository root.
````

- [ ] **Step 4: Full verification**

```bash
pnpm --filter @waitron/verifactu typecheck
pnpm --filter @waitron/verifactu test:coverage
pnpm --filter @waitron/verifactu mutation
pnpm lint
pnpm format:check
```

Expected: typecheck clean; all tests pass with coverage above the configured thresholds; mutation score ≥ 90; lint and format clean.

- [ ] **Step 5: Commit**

```bash
git add packages/verifactu
git commit -m "feat(verifactu): public surface, conformance suite and README

Exports the complete API and pins AEAT's three published vectors as a
standalone conformance suite. If one fails the implementation is wrong; a
vector is never adjusted to match the code.

The README leads with the josemmo framing — a tool for building SIFs, not a
SIF — because that distinction is the basis of the project's position on who
signs the declaracion responsable."
```

---

## Self-Review

**Spec coverage.** Every element of spec §5's library surface maps to a task: `buildAltaRecord`/`buildAnulacionRecord` (4), `computeHuella`/`verifyHuella` (3), `validate` (5), `serializeEnvio`/`serializeConsulta` (7), `parseRespuestaSuministro` (8), `parseRespuestaConsulta` (9), `createClient` (10). The serialisation policy is Task 2, the 1,000-record cap Task 7, the 3000 inversion Task 8, the enum divergence Task 9, `PROVENANCE.md` Task 1, mutation gating Task 1, conformance vectors Tasks 3 and 11.

**Deliberately out of scope**, each belonging to plan 2 or later: the outbox and retry scheduler, `Incidencia="S"`, acks, reconciliation sweeps, the `FiscalBackend` interface, all database work, and the CSV persistence rule — a caller obligation this library cannot enforce, though its parser surfaces the CSV exactly once so the caller can meet it.

**Known gaps, stated rather than hidden:**

1. **Namespace URIs in Task 7 are transcribed, not verified.** They must be checked against the local XSDs before that task is done. Flagged inline.
2. **Response fixtures in Tasks 8 and 9 are hand-built** from the schemas rather than captured from AEAT, because no preproduction access exists. They encode our reading of the response format — the same limitation spec §1 records for the fake endpoint generally.
3. **Task 10's transport tests pass an empty batch**, which `serializeEnvio` rejects. Resolve by passing one record, not by weakening the cap check. Flagged inline.
4. **`RegistroEvento` is not implemented.** Not required in Veri\*Factu mode. `joinCampos` already takes ordered tuples so the repeated `NIF` key would work if it is ever needed.
5. **Differential testing against `mdiago/VeriFactu`** as a black-box oracle (spec §10) is not a task here — it needs the binary and a .NET runtime, so it is better as a follow-up once the implementation is complete and there is something to differ against.

