import type { RecordSaleInput } from "@waitron/core";
import type { TrustedClock } from "@waitron/fiscal";
import type { SeriesId, TenantId, TillId, WorkingOrderId } from "@waitron/shared";
import { createFakeAeat } from "@waitron/verifactu/src/testing/fake-aeat.js";
import type { VerifactuClient } from "@waitron/verifactu";

const BASE = new Date("2026-03-01T13:05:00+01:00");

/**
 * `VerifactuBackendOptions.client` (Task 5) is required by the constructor, even though not one
 * test in this package calls `drain` — the only method that reads it. A single module-scope fake
 * AEAT transport, shared across every `new VerifactuBackend(...)` site in this package, is
 * therefore enough: nothing here submits anything, so which fake instance answers is irrelevant,
 * and minting a fresh `createFakeAeat()` per test would be decoration with no consumer. Deep
 * import mirrors this package's own `FakeFiscalBackend` convention (`@waitron/fiscal/src/testing/
 * fake-backend.js`, imported by `packages/core`'s tests): `@waitron/verifactu` exports no test
 * doubles from its own package surface either.
 */
export const fakeClient: VerifactuClient = createFakeAeat().client();

/**
 * Confident, fixed, +01:00. `anchor`/`currentAnchor` are stubs — `recordSale` never calls either
 * (it reads `now()` exactly once), and `VerifactuBackend.recordVoid` is the only place in this
 * package that would (not exercised by `write-path.e2e.test.ts`, which only calls `recordSale`).
 */
export const steadyClock: TrustedClock = {
  now: () => ({
    instant: BASE,
    offsetMinutes: 60,
    confident: true,
    confidence: "anchored",
    anchorAgeSeconds: 0,
  }),
  anchor: () => {
    throw new Error("steadyClock: anchor() is not used by recordSale");
  },
  currentAnchor: () => null,
};

/**
 * Builds a `RecordSaleInput` from `@waitron/core` for `write-path.e2e.test.ts`. Mirrors
 * `packages/core/src/record-sale.test.ts`'s own `input()` fixture — same reconciled base/tax
 * figures (10.00 base + 2.10 tax at 21%, 2.10 base + 0.21 tax at 10%, taxable total 14.41) — so a
 * reader who has already seen that suite recognises the numbers here rather than re-deriving them.
 */
export function saleInput(
  params: {
    tenantId: TenantId;
    tillId: TillId;
    seriesId: SeriesId;
    workingOrderId: WorkingOrderId;
  } & Partial<RecordSaleInput>,
): RecordSaleInput {
  const { tenantId, tillId, seriesId, workingOrderId, ...overrides } = params;
  return {
    tenantId,
    tillId,
    seriesId,
    workingOrderId,
    locale: "es-ES",
    invoiceLocales: ["es-ES"],
    total: "14.41",
    tipAmount: "1.90",
    lines: [
      {
        lineNo: 1,
        descriptions: { "es-ES": "Café solo" },
        quantity: "2",
        unitPrice: "5.00",
        vatRate: "21.00",
        lineTotal: "10.00",
      },
      {
        lineNo: 2,
        descriptions: { "es-ES": "Agua" },
        quantity: "1",
        unitPrice: "2.10",
        vatRate: "10.00",
        lineTotal: "2.10",
      },
    ],
    tenders: [{ method: "card", amount: "16.31", settledAt: BASE }],
    fiscalBackend: "verifactu",
    clock: steadyClock,
    ...overrides,
  };
}
