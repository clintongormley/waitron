# Exact-Decimal Amounts Through the Huella — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove `number` from the fiscal-amount path — no monetary amount (or exact-decimal VAT rate) round-trips through IEEE-754 binary floating point anywhere in `packages/verifactu`.

**Architecture:** Three changes. (1) `@waitron/shared` gains the exact `divideDecimal` primitive it was missing, and `packages/core`'s `vat.ts` — which reimplements a private BigInt codec today — routes through it, retiring the duplicate. (2) `packages/verifactu` (a **zero-in-repo-dependency** standalone library, so it cannot import `@waitron/shared`) gains its own self-contained `formatAmountExact(string)` codec. (3) The library's `AltaInput`/`DetalleDesgloseInput`/`DesgloseRectificacionInput` amount and rate fields change from `number` to `string`; `buildAltaRecord` formats them via `formatAmountExact`; `formatAmount(number)` is removed; and every `AltaInput` constructor — fixtures, tests, and `VerifactuBackend.recordSale` (dropping its `Number(...)`) — is re-expressed with exact strings.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), BigInt exact-decimal arithmetic, Vitest, fast-check (property-based), Stryker (mutation, 90% gate on `packages/verifactu`), pnpm workspaces.

**Design doc:** [`docs/superpowers/specs/2026-07-21-submission-and-reconciliation-design.md`](../specs/2026-07-21-submission-and-reconciliation-design.md) §2.3. Serialisation policy: [`2026-07-19-sales-spine-and-fiscal-layer-design.md`](../specs/2026-07-19-sales-spine-and-fiscal-layer-design.md) §5.

## Global Constraints

- **`packages/verifactu` has ZERO in-repo dependencies** (only `fast-xml-parser`), enforced by a lint boundary. `formatAmountExact` and everything else in `packages/verifactu` must NOT import `@waitron/shared` or any other `@waitron/*` package. The shared `divideDecimal` (Task 1) is for `packages/core` only.
- **Serialise once, hash that exact literal.** The huella is SHA-256 over the literal string. `formatAmountExact` must emit exactly the same 2-decimal literal `formatAmount` did for equal values, so the vector-1 huella and the conformance vectors are preserved byte-for-byte.
- **Rounding is half away from zero, to exactly 2 decimals**, matching `formatAmount` and `@waitron/shared`'s `toScale`. Changing the mode is a primary-source question, not an implementation choice.
- **Never introduce a `number`→amount path.** After this change, formatting an amount from a JS `number` must be impossible in `packages/verifactu` (that is why `formatAmount` is removed, not merely left unused).
- **Per-test red phase** — observe every new/changed test failing before implementing. **Real database, never mocked** for the `packages/fiscal-verifactu` write-path e2e (PGlite). **Mutation gate 90%** on `packages/verifactu` (required CI check `mutation-verifactu`).
- CI runs `REQUIRE_DOCKER=1 pnpm -r test:coverage`; required checks: `static-analysis`, `typecheck`, `test`, `mutation-verifactu`, `mutation-shared`. Run the full gate before the PR.

## File Structure

**Task 1 — shared `divideDecimal` + `vat.ts` dedup:**
- Modify `packages/shared/src/money.ts` — add `divideDecimal(dividend, divisor, scale)`.
- Modify `packages/shared/src/index.ts` — export it (confirm barrel re-exports money ops).
- Modify `packages/core/src/vat.ts` — rewrite `percentOf` via `multiplyDecimal` + `divideDecimal`; delete its private `parts`/`render`.
- Tests: `packages/shared/src/money.test.ts`, `packages/core/src/vat.test.ts` (if present; else add focused tests).

**Task 2 — `formatAmountExact` (self-contained in verifactu):**
- Modify `packages/verifactu/src/format.ts` — add `formatAmountExact(value: string): string`.
- Modify `packages/verifactu/src/index.ts` — export it.
- Modify `packages/verifactu/src/format.test.ts` — add its tests.

**Task 3 — the atomic type change (verifactu + fiscal-verifactu together):**
- Modify `packages/verifactu/src/types.ts` — the amount/rate fields on `AltaInput`, `DetalleDesgloseInputCommon`, `DesgloseRectificacionInput` → `string`.
- Modify `packages/verifactu/src/records.ts` — `formatDetalle`/`formatImporteRectificacion`/`buildAltaRecord` use `formatAmountExact`; drop the `formatAmount` import.
- Modify `packages/verifactu/src/format.ts` — **remove** `formatAmount`; `packages/verifactu/src/index.ts` — drop its export; `packages/verifactu/src/format.test.ts` — remove the `formatAmount` describe block (its cases now live under `formatAmountExact`).
- Modify the `AltaInput`/`DetalleDesgloseInput` constructors: `packages/verifactu/test/fixtures.ts` (`ALTA_INPUT`), `packages/verifactu/src/records.test.ts`, `packages/verifactu/src/huella.test.ts`, `packages/verifactu/src/qr.test.ts`, `packages/verifactu/src/xml/serialize.test.ts`, `packages/verifactu/src/validate.test.ts`, `packages/verifactu/src/index.test.ts` (only those that actually build an `AltaInput`/`DetalleDesgloseInput` with numeric amounts — grep-confirm each).
- Modify `packages/fiscal-verifactu/src/backend.ts` — `VerifactuBackend.recordSale` passes exact `Decimal` strings (drop every `Number(...)`); `packages/fiscal-verifactu/src/testing/seed.ts` — `altaFor` uses string amounts; `packages/fiscal-verifactu/src/backend.test.ts` — the direct `recordSale` desglose fixture (lines ~224-227) uses strings.

---

### Task 1: `divideDecimal` in `@waitron/shared`, and retire `vat.ts`'s duplicate codec

Adds the exact division `@waitron/shared` lacks (the reason `vat.ts` reimplements the BigInt codec), then rewrites `percentOf` to use it — removing the third copy.

**Interfaces:**
- Produces: `divideDecimal(dividend: Decimal, divisor: Decimal, scale: number): Decimal` — exact quotient rounded half away from zero to `scale` places; throws `shared.invalid_decimal`-style on divide-by-zero.
- Consumes (Task 3 uses none of this; `vat.ts` internal only): existing `multiplyDecimal`, `partsOf` (private), `fromParts` (private), `decimal`.

- [ ] **Step 1: Write the failing `divideDecimal` tests**

In `packages/shared/src/money.test.ts`, add a `describe("divideDecimal", ...)`. These pin exactness and half-away rounding.

```typescript
describe("divideDecimal", () => {
  it("divides exactly and rounds half away from zero to scale", () => {
    expect(divideDecimal(decimal("10"), decimal("3"), 2)).toBe("3.33");
    expect(divideDecimal(decimal("2"), decimal("3"), 4)).toBe("0.6667");
    expect(divideDecimal(decimal("1"), decimal("8"), 2)).toBe("0.13"); // 0.125 → half away → 0.13
    expect(divideDecimal(decimal("-1"), decimal("8"), 2)).toBe("-0.13");
  });

  it("reproduces a VAT-style base*rate/100 to two places", () => {
    // 111.10 * 21 / 100 = 23.331 → 23.33
    expect(divideDecimal(multiplyDecimal(decimal("111.10"), decimal("21")), decimal("100"), 2)).toBe(
      "23.33",
    );
  });

  it("throws on division by zero", () => {
    expect(() => divideDecimal(decimal("1"), decimal("0"), 2)).toThrow();
  });
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `pnpm --filter @waitron/shared test money`
Expected: FAIL — `divideDecimal is not a function`.

- [ ] **Step 3: Implement `divideDecimal`**

In `packages/shared/src/money.ts`, add (after `multiplyDecimal`), reusing the existing private `partsOf`/`fromParts`:

```typescript
/**
 * Exact quotient `dividend / divisor`, rounded half away from zero to `scale` places — the
 * division `@waitron/shared` otherwise lacks (which is why `packages/core/src/vat.ts` used to
 * reimplement this file's private codec). Computed entirely in BigInt: never a JS number.
 */
export function divideDecimal(dividend: Decimal, divisor: Decimal, scale: number): Decimal {
  const a = partsOf(dividend);
  const b = partsOf(divisor);
  if (b.units === 0n) {
    throw new AppError("shared.invalid_decimal", { value: `${dividend} / ${divisor}` });
  }
  // value = (a.units / 10^a.scale) / (b.units / 10^b.scale), rendered at `scale` decimals:
  //   result.units = round( a.units * 10^b.scale * 10^scale / (b.units * 10^a.scale) )
  const num = a.units * 10n ** BigInt(b.scale) * 10n ** BigInt(scale);
  const den = b.units * 10n ** BigInt(a.scale);
  const negative = num < 0n !== den < 0n;
  const absNum = num < 0n ? -num : num;
  const absDen = den < 0n ? -den : den;
  const quotient = absNum / absDen;
  const remainder = absNum % absDen;
  const rounded = remainder * 2n >= absDen ? quotient + 1n : quotient;
  return fromParts({ units: negative && rounded !== 0n ? -rounded : rounded, scale });
}
```

- [ ] **Step 4: Export it and run the tests green**

In `packages/shared/src/index.ts`, add `divideDecimal` to the money re-export list (match how `multiplyDecimal` is exported).

Run: `pnpm --filter @waitron/shared test money`
Expected: PASS.

- [ ] **Step 5: Rewrite `vat.ts`'s `percentOf` through the shared primitives**

Replace the body of `packages/core/src/vat.ts` — delete the private `parts`/`render` helpers entirely and route `percentOf` through `multiplyDecimal` + `divideDecimal`:

```typescript
import { MONEY_SCALE, divideDecimal, multiplyDecimal } from "@waitron/shared";
import type { Decimal } from "@waitron/shared";

/**
 * `ratePercent`% of `amount`, exact and rounded half away from zero to `scale` places (money
 * scale by default). `ratePercent` is a PERCENTAGE literal as this system stores it ("21.00"
 * meaning 21%), so the division by 100 is folded in: amount * rate / 100.
 *
 * Exact throughout via `@waitron/shared`'s BigInt decimal ops — this file no longer keeps its own
 * copy of that package's codec now that `divideDecimal` exists there.
 */
export function percentOf(amount: Decimal, ratePercent: Decimal, scale = MONEY_SCALE): Decimal {
  return divideDecimal(multiplyDecimal(amount, ratePercent), "100" as Decimal, scale);
}
```

> `"100" as Decimal` matches the file's existing brand-cast convention; if `vat.ts` prefers `decimal("100")`, use that — confirm against the file's imports.

- [ ] **Step 6: Run the vat + core suites green**

Run: `pnpm --filter @waitron/core test vat && pnpm --filter @waitron/core test record-sale`
Expected: PASS — `percentOf`'s outputs are unchanged (same exact base×rate/100, same rounding), so `record-sale`'s VAT-breakdown assertions still hold. If `vat.test.ts` does not exist, add a small one asserting the two examples currently covered indirectly by `record-sale.test.ts` (e.g. `percentOf(decimal("10.00"), decimal("21.00"))` → `"2.10"`).

- [ ] **Step 7: Typecheck + commit**

Run: `pnpm --filter @waitron/shared --filter @waitron/core typecheck`
Expected: PASS.

```bash
git add packages/shared packages/core/src/vat.ts packages/core/src/vat.test.ts
git commit -m "refactor: add exact divideDecimal to @waitron/shared, retire vat.ts's codec copy"
```

---

### Task 2: `formatAmountExact(string)` in `packages/verifactu`

A self-contained BigInt string→2-decimal-literal codec, with the same output guarantees as `formatAmount(number)` but no float. **No `@waitron/shared` import** (zero-dep boundary).

**Interfaces:**
- Produces: `formatAmountExact(value: string): string` — parses an exact decimal string, rounds half away from zero to 2 decimals, emits `[-]<int>.<2dp>` (no leading `+`, `-` only for genuine negatives, ≤12 integer digits). Throws on a non-decimal string or >12 integer digits.
- Consumes: nothing (pure, self-contained).

- [ ] **Step 1: Write the failing `formatAmountExact` tests**

In `packages/verifactu/src/format.test.ts`, add a `describe("formatAmountExact", ...)`. These mirror `formatAmount`'s guarantees on string input, plus string-specific validation. Include a fast-check property.

```typescript
describe("formatAmountExact", () => {
  it("emits exactly two decimals", () => {
    expect(formatAmountExact("123")).toBe("123.00");
    expect(formatAmountExact("123.1")).toBe("123.10");
    expect(formatAmountExact("123.45")).toBe("123.45");
  });
  it("never emits a leading +, and - only for genuine negatives", () => {
    expect(formatAmountExact("123.45")).not.toContain("+");
    expect(formatAmountExact("-123.45")).toBe("-123.45");
    expect(formatAmountExact("0")).toBe("0.00");
    expect(formatAmountExact("-0")).toBe("0.00"); // rejected by pattern? see note — use "-0.00" input
  });
  it("rounds half away from zero on the third decimal", () => {
    expect(formatAmountExact("0.125")).toBe("0.13");
    expect(formatAmountExact("-0.125")).toBe("-0.13");
    expect(formatAmountExact("0.124")).toBe("0.12");
    expect(formatAmountExact("0.995")).toBe("1.00"); // carry
    expect(formatAmountExact("-0.995")).toBe("-1.00");
    expect(formatAmountExact("-0.001")).toBe("0.00"); // rounds to zero → unsigned
  });
  it("accepts the full 12 integer digits and rejects 13", () => {
    expect(formatAmountExact("999999999999")).toBe("999999999999.00");
    expect(() => formatAmountExact("1000000000000")).toThrow(/12/);
    expect(() => formatAmountExact("999999999999.999")).toThrow(/12/); // carry pushes to 13
  });
  it("rejects non-decimal strings", () => {
    expect(() => formatAmountExact("abc")).toThrow();
    expect(() => formatAmountExact("+1.00")).toThrow();
    expect(() => formatAmountExact("1.2.3")).toThrow();
    expect(() => formatAmountExact("")).toThrow();
  });
  it("property: round-trips a canonical 2dp decimal to itself", () => {
    fc.assert(
      fc.property(fc.integer({ min: -999_999, max: 999_999 }), fc.integer({ min: 0, max: 99 }), (i, c) => {
        const s = `${i}.${String(c).padStart(2, "0")}`;
        // decimal(...) form the value already carries; formatAmountExact must not alter a 2dp literal
        expect(formatAmountExact(s.replace("-0.", "0."))).toBe(
          `${i}.${String(c).padStart(2, "0")}`.replace(/^-0\./, "0."),
        );
      }),
    );
  });
});
```

> Note on `"-0"`: `formatAmount`'s tests use `formatAmount(-0)`. On the string side, the input analogous to negative-zero is `"-0"` or `"-0.00"` — but the amount pattern rejects a `-` on a zero magnitude the way `@waitron/shared`'s `decimal()` does. Decide during Step 3: either (a) the pattern rejects `"-0"` and the test asserts it throws, or (b) the pattern accepts it and the sign logic strips it to `"0.00"`. Pick (b) to mirror `formatAmount(-0) === "0.00"`, and assert `formatAmountExact("-0.00") === "0.00"`; fix the test above to match the choice.

- [ ] **Step 2: Run and watch them fail**

Run: `pnpm --filter @waitron/verifactu test format`
Expected: FAIL — `formatAmountExact is not a function`. Ensure `fc` is imported in `format.test.ts` (fast-check; used elsewhere in this package — copy the import).

- [ ] **Step 3: Implement `formatAmountExact`**

In `packages/verifactu/src/format.ts`, add (self-contained; the `MAX_INTEGER_DIGITS` const already exists in this file):

```typescript
// Anchored, no exponent, no leading plus, no leading zeros, at least one digit each side of a
// point — the same shape @waitron/shared's Decimal uses, re-stated here because packages/verifactu
// has ZERO in-repo dependencies and cannot import it.
const AMOUNT_PATTERN = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;

/**
 * Formats an exact decimal STRING as the record literal: always two decimals, `.` separator,
 * never a leading `+`, `-` only for a genuine negative, half away from zero. The exact-string twin
 * of `formatAmount(number)` — same output, but the value never passes through a JS number, so the
 * float-representation error that `formatAmount` had to defend against cannot arise at all.
 */
export function formatAmountExact(value: string): string {
  if (typeof value !== "string" || !AMOUNT_PATTERN.test(value)) {
    throw new Error(`Amount must be an exact decimal string, received ${JSON.stringify(value)}`);
  }
  const negative = value.startsWith("-");
  const body = negative ? value.slice(1) : value;
  const point = body.indexOf(".");
  const intText = point === -1 ? body : body.slice(0, point);
  const fracText = point === -1 ? "" : body.slice(point + 1);

  let integer = BigInt(intText);
  let cents = BigInt((fracText + "00").slice(0, 2));
  // Half away from zero, decided by the third decimal alone: "5".."9" is at or above half a cent
  // no matter what follows it, "0".."4" is below no matter what follows it.
  if (fracText.length > 2 && fracText[2] >= "5") {
    cents += 1n;
    if (cents === 100n) {
      cents = 0n;
      integer += 1n;
    }
  }
  if (integer.toString().length > MAX_INTEGER_DIGITS) {
    throw new Error(
      `Amount exceeds the ${MAX_INTEGER_DIGITS} integer digits permitted by ImporteSgn12.2Type`,
    );
  }
  const sign = negative && (integer !== 0n || cents !== 0n) ? "-" : "";
  return `${sign}${integer.toString()}.${cents.toString().padStart(2, "0")}`;
}
```

- [ ] **Step 4: Export it and run green**

In `packages/verifactu/src/index.ts`, add `formatAmountExact` to the `./format.js` export line (alongside `formatAmount` for now — `formatAmount` is removed in Task 3).

Run: `pnpm --filter @waitron/verifactu test format`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/verifactu/src/format.ts packages/verifactu/src/format.test.ts packages/verifactu/src/index.ts
git commit -m "feat(verifactu): add formatAmountExact — exact-string 2dp amount codec, no float"
```

---

### Task 3: Convert the fiscal-amount fields to `string` and route through `formatAmountExact`

The atomic change: the library's amount/rate input fields become `string`, `buildAltaRecord` formats via `formatAmountExact`, `formatAmount` is removed, and every constructor across `packages/verifactu` and `packages/fiscal-verifactu` is re-expressed. Done in one commit so the monorepo typechecks at the task boundary (a `number→string` field break spans both packages).

**Interfaces:**
- Consumes: `formatAmountExact` (Task 2).
- Produces: `AltaInput.CuotaTotal`/`ImporteTotal`: `string`; `DetalleDesgloseInputCommon.{TipoImpositivo, BaseImponibleOimporteNoSujeto, BaseImponibleACoste, CuotaRepercutida, TipoRecargoEquivalencia, CuotaRecargoEquivalencia}`: `string`; `DesgloseRectificacionInput.{BaseRectificada, CuotaRectificada, CuotaRecargoRectificado}`: `string`. `formatAmount` no longer exists.

- [ ] **Step 1: Flip the input types to `string`**

In `packages/verifactu/src/types.ts`:
- `DetalleDesgloseInputCommon` (lines ~178-187): change `TipoImpositivo?`, `BaseImponibleOimporteNoSujeto`, `BaseImponibleACoste?`, `CuotaRepercutida?`, `TipoRecargoEquivalencia?`, `CuotaRecargoEquivalencia?` from `number` to `string`.
- `DesgloseRectificacionInput` (lines ~202-206): `BaseRectificada`, `CuotaRectificada`, `CuotaRecargoRectificado?` → `string`.
- `AltaInput` (lines ~241-242): `CuotaTotal`, `ImporteTotal` → `string`.

Update the doc comments that say "amounts arrive as numbers, formatted once by the builder" to "amounts arrive as exact decimal strings".

- [ ] **Step 2: Route `records.ts` through `formatAmountExact`**

In `packages/verifactu/src/records.ts`, change the import to `formatAmountExact` and replace every `formatAmount(...)` call (the 11 sites in `formatDetalle`, `formatImporteRectificacion`, `buildAltaRecord`) with `formatAmountExact(...)`. Same argument names, now strings.

```typescript
import { formatDate, formatDateTime } from "./format.js";
import { formatAmountExact } from "./format.js";
```
e.g. `TipoImpositivo: formatAmountExact(detalle.TipoImpositivo)`, `BaseImponibleOimporteNoSujeto: formatAmountExact(detalle.BaseImponibleOimporteNoSujeto)`, … `CuotaTotal: formatAmountExact(input.CuotaTotal)`, `ImporteTotal: formatAmountExact(input.ImporteTotal)`.

- [ ] **Step 3: Remove `formatAmount`**

- Delete `formatAmount` from `packages/verifactu/src/format.ts` (the whole function, lines ~40-102).
- Remove `formatAmount` from the `./format.js` export in `packages/verifactu/src/index.ts` (keep `formatAmountExact`, `formatDate`, `formatDateTime`, `trimValue`).
- In `packages/verifactu/src/format.test.ts`, delete the `describe("formatAmount", ...)` block. Its rounding/overflow cases are already covered by the `formatAmountExact` block from Task 2 (string inputs); do not lose the carry/overflow cases — confirm each has a `formatAmountExact` equivalent, add any that are missing.

- [ ] **Step 4: Re-express every `AltaInput`/`DetalleDesgloseInput` constructor with strings**

Grep first to get the exact set: `grep -rn "CuotaTotal:\|BaseImponibleOimporteNoSujeto:\|TipoImpositivo:\|CuotaRepercutida:\|ImporteTotal:" packages/verifactu packages/fiscal-verifactu --include="*.ts" | grep -v "src/types.ts\|src/records.ts\|src/huella.ts\|vectors.ts\|parse-\|registros.ts"`.

For `packages/verifactu/test/fixtures.ts` `ALTA_INPUT`, convert the numeric literals to exact decimal strings (the Desglose amounts are not hashed, so their exact form is free; `CuotaTotal`/`ImporteTotal` MUST format to the same 2dp literal to preserve the vector-1 huella):

```typescript
  Desglose: [
    {
      CalificacionOperacion: "S1",
      BaseImponibleOimporteNoSujeto: "111.10",
      CuotaRepercutida: "12.35",
      TipoImpositivo: "21.00",
    },
  ],
  CuotaTotal: "12.35",
  ImporteTotal: "123.45",
```

Apply the same conversion to the `AltaInput`/`DetalleDesgloseInput` literals in `records.test.ts`, `huella.test.ts`, `qr.test.ts` (its own alta fixture), `xml/serialize.test.ts`, `validate.test.ts`, and `index.test.ts` — **only where they construct an input with numeric amounts** (many of these use `ALTA_INPUT` or the already-string `RegistroAlta`/`CadenaAltaInput`, which need no change; grep-confirm each file).

- [ ] **Step 5: Update `packages/fiscal-verifactu` — the real producer and its fixtures**

In `packages/fiscal-verifactu/src/backend.ts` `recordSale`, drop the `Number(...)` conversions — pass the exact `Decimal` strings straight through:

```typescript
    const desglose: DetalleDesgloseInput[] = sale.vatBreakdown.map((line) => ({
      BaseImponibleOimporteNoSujeto: line.base,
      TipoImpositivo: line.rate,
      CuotaRepercutida: line.tax,
      CalificacionOperacion: "S1",
    }));
    const cuotaTotal = sumDecimals(sale.vatBreakdown.map((line) => line.tax));
    const input: Omit<AltaInput, "Encadenamiento"> = {
      ...
      CuotaTotal: cuotaTotal,
      ImporteTotal: sale.total,
      ...
    };
```
(`line.base`/`line.rate`/`line.tax`/`sale.total`/`cuotaTotal` are all `Decimal` — assignable to `string`. If a nominal-type mismatch appears, `String(...)` the `Decimal` or widen the local type; do NOT reintroduce `Number`.)

In `packages/fiscal-verifactu/src/testing/seed.ts`, change `altaFor`'s `CuotaTotal`/`ImporteTotal`/Desglose numeric literals to strings. In `packages/fiscal-verifactu/src/backend.test.ts`, the direct `recordSale` desglose fixture (~lines 224-227) is `SaleForFiscalRecord` (already `Decimal`), so it likely needs no change — grep-confirm it does not build an `AltaInput`/`DetalleDesgloseInput` literal.

- [ ] **Step 6: Verify the vectors, huella, and both packages green**

Run: `pnpm --filter @waitron/verifactu test`
Expected: PASS — critically `records.test.ts`'s "reproduces AEAT's vector 1 huella from native inputs" and `conformance.test.ts` (the latter uses `CadenaAltaInput`, unaffected, but must stay green). If the vector-1 huella changed, a hashed amount's literal changed — fix the fixture's `CuotaTotal`/`ImporteTotal` string to format identically.

Run: `REQUIRE_DOCKER=1 pnpm --filter @waitron/fiscal-verifactu test`
Expected: PASS — the write-path/void-path e2e prove `VerifactuBackend.recordSale` still produces the correct stored registro (now built from exact strings, no `Number`).

- [ ] **Step 7: Typecheck the whole graph + commit**

Run: `pnpm -r typecheck`
Expected: PASS across all packages (this is the check that the cross-package `number→string` break is fully resolved).

```bash
git add packages/verifactu packages/fiscal-verifactu
git commit -m "refactor: exact-string amounts through the huella; remove formatAmount(number)"
```

---

### Final verification (before opening the PR)

- [ ] **Run the full gate as CI runs it**

Run: `REQUIRE_DOCKER=1 pnpm -r test:coverage && pnpm -r typecheck && pnpm lint`
Expected: PASS everywhere, coverage thresholds met.

- [ ] **Confirm the mutation gate on verifactu**

Run: `pnpm --filter @waitron/verifactu mutation` (Stryker; the `mutation-verifactu` required check). Expected: ≥90%. `formatAmountExact` is pure over plain data — the most mutation-testable code in the project — so surviving mutants mean a missing case; add it.

- [ ] **Confirm no `number`→amount path remains**

Run: `grep -rn "formatAmount\b" packages/verifactu/src` — expected: no `formatAmount(` calls remain (only `formatAmountExact`); and `grep -rn "Number(" packages/fiscal-verifactu/src/backend.ts` — expected: no `Number(...)` on an amount.

## Self-Review

Checked against design doc §2.3 and the brainstorm decisions (all amount+rate fields → string; retire the codec via a shared export; `formatAmountExact` self-contained in the zero-dep library):

- **Spec coverage:** §2.3's `formatAmountExact(string)` → Task 2; `AltaInput.CuotaTotal/ImporteTotal` (and, per the "all amounts" decision, the Desglose + rectificación + rate fields) → Task 3 Step 1; route `recordSale`/`vat.ts` through exact decimals → Task 3 Step 5 + Task 1; retire the `@waitron/shared` codec copy → Task 1. The zero-dep correction (verifactu keeps its own codec) is stated in Global Constraints and Task 2.
- **Placeholders:** none. The two decision points that need in-file confirmation (`"-0"` handling in Task 2 Step 1/3; the exact grep set of `AltaInput` constructors in Task 3 Step 4) are called out with the resolution to make, not left vague.
- **Type consistency:** `formatAmountExact(value: string): string` used identically in `format.ts`, `records.ts`, and the export. The `number→string` field change is applied to the types (Step 1), the builder (Step 2), and every constructor (Steps 4-5) in one atomic task, so no site is left passing a `number` to a `string` field. `divideDecimal(dividend, divisor, scale)` used consistently in money.ts, its export, and `vat.ts`.
