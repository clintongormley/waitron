import type { RecordSaleInput } from "@waitron/core";
import type { TrustedClock } from "@waitron/fiscal";
import type { NodeId, SeriesId, TillId } from "@waitron/shared";
import { createFakeAeat } from "@waitron/verifactu/testing";
import type { VerifactuClient } from "@waitron/verifactu";

const BASE = new Date("2026-03-01T13:05:00+01:00");

/**
 * `VerifactuBackendOptions.resolveClient` is required by the constructor. A single module-scope
 * fake AEAT transport, shared via `staticResolver` below, is enough: nothing in these suites
 * submits anything distinguishable, so which fake instance answers is irrelevant.
 */
export const fakeClient: VerifactuClient = createFakeAeat().client();

/**
 * A `resolveClient` that always returns `client` — the shape every `VerifactuBackend` in this
 * package's suites must supply SOME `resolveClient` to satisfy, for the reason `fakeClient` above
 * documents. Do NOT reach for this in a test that cares WHEN the transport is resolved, or that
 * needs a throwing one — write a bespoke resolver instead.
 */
export function staticResolver(client: VerifactuClient): () => Promise<VerifactuClient> {
  return () => Promise.resolve(client);
}

/** Confident, fixed, +01:00. `anchor`/`currentAnchor` are stubs: `recordSale` never calls either. */
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
 * Builds a `RecordSaleInput` from `@waitron/core`: 10.00 base + 2.10 tax at 21%, 2.10 base + 0.21
 * tax at 10%, taxable total 14.41.
 */
export function saleInput(
  params: {
    tillId: TillId;
    nodeId: NodeId;
    seriesId: SeriesId;
  } & Partial<RecordSaleInput>,
): RecordSaleInput {
  const { tillId, nodeId, seriesId, ...overrides } = params;
  return {
    tillId,
    nodeId,
    seriesId,
    locale: "es-ES",
    invoiceLocales: ["es-ES"],
    total: "14.41",
    lines: [
      {
        lineNo: 1,
        name: "Café solo",
        descriptions: { "es-ES": "Café solo" },
        quantity: "2",
        unitPrice: "5.00",
        vatRate: "21.00",
        lineTotal: "10.00",
      },
      {
        lineNo: 2,
        name: "Agua",
        descriptions: { "es-ES": "Agua" },
        quantity: "1",
        unitPrice: "2.10",
        vatRate: "10.00",
        lineTotal: "2.10",
      },
    ],
    // Immediate settlement with the tip on the tender: sum(amount) 16.31 = total 14.41 + tip 1.90.
    settlement: {
      kind: "immediate",
      tenders: [{ method: "card", amount: "16.31", tipAmount: "1.90", settledAt: BASE }],
    },
    clock: steadyClock,
    ...overrides,
  };
}
