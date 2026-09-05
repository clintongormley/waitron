import type { RecordSaleInput } from "@waitron/core";
import type { TrustedClock } from "@waitron/fiscal";
import type { NodeId, SeriesId, TenantId, TillId } from "@waitron/shared";
import { createFakeAeat } from "@waitron/verifactu/src/testing/fake-aeat.js";
import type { VerifactuClient } from "@waitron/verifactu";

const BASE = new Date("2026-03-01T13:05:00+01:00");

/**
 * `VerifactuBackendOptions.resolveClient` (Task 5) is required by the constructor, and is read by
 * both `drain` and `reconcile` (`drain.test.ts`, `acks.test.ts`, `drain.concurrency.test.ts`, and
 * others across this package all call `backend.drain`/`backend.reconcile`). A single module-scope
 * fake AEAT transport, shared across every `new VerifactuBackend(...)` site in this package via
 * `staticResolver` below, is therefore enough for the tests that never care which tenant's
 * transport they got — nothing in THOSE tests submits anything distinguishable per tenant, so
 * which fake instance answers is irrelevant, and minting a fresh `createFakeAeat()` per test would
 * be decoration with no consumer. Deep import mirrors this package's own `FakeFiscalBackend`
 * convention (`@waitron/fiscal/src/testing/fake-backend.js`, imported by `packages/core`'s tests):
 * `@waitron/verifactu` exports no test doubles from its own package surface either.
 */
export const fakeClient: VerifactuClient = createFakeAeat().client();

/**
 * A `resolveClient` that ignores its `tenantId` argument and always returns `client` — the shape
 * every `VerifactuBackend` in this package's suites must supply SOME `resolveClient` to satisfy
 * (Task 5 made the field required), for a test that never cares which tenant's transport it got,
 * for the reason `fakeClient` above documents. Do NOT reach for this in a test that DOES care which
 * tenant asked — one asserting per-tenant isolation, or that a different (or throwing) client
 * answers depending on `tenantId` — write a bespoke resolver instead, the way
 * `drain.tenancy.test.ts`'s `recordingResolver` does.
 */
export function staticResolver(
  client: VerifactuClient,
): (tenantId: TenantId) => Promise<VerifactuClient> {
  return () => Promise.resolve(client);
}

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
    nodeId: NodeId;
    seriesId: SeriesId;
  } & Partial<RecordSaleInput>,
): RecordSaleInput {
  const { tenantId, tillId, nodeId, seriesId, ...overrides } = params;
  return {
    tenantId,
    tillId,
    nodeId,
    seriesId,
    locale: "es-ES",
    invoiceLocales: ["es-ES"],
    total: "14.41",
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
    // Immediate settlement with the tip on the tender (design D2): sum(amount) 16.31 = total 14.41 +
    // tip 1.90, matching record-sale.test.ts's own DEFAULT_TENDERS so the numbers line up across
    // suites.
    settlement: {
      kind: "immediate",
      tenders: [{ method: "card", amount: "16.31", tipAmount: "1.90", settledAt: BASE }],
    },
    clock: steadyClock,
    ...overrides,
  };
}
