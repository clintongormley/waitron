import { expect, it } from "vitest";
import { parseConflictResult } from "./conflict-recovery-contract.js";

const evidence = {
  source: "consulta",
  invoice: {
    IDEmisorFactura: "B12345674",
    NumSerieFactura: "A/1",
    FechaExpedicionFactura: "20-07-2026",
  },
  reference: "foreign-copy",
  state: "Correcto",
  fingerprint: "D".repeat(64),
  system: { taxId: "89890001K", softwareId: "WT", installation: "2" },
};
function status(value: unknown) {
  return {
    kind: "status",
    active: [
      {
        registroId: "record",
        caseId: "case",
        sifId: "sif",
        installationIdentity: "1",
        invoiceIdentity: "A/1",
        observedAt: "2026-07-21T00:01:00.000Z",
        evidence: value,
        cause: "fiscal.huella_divergente",
        evidenceId: "observation",
      },
    ],
    event: { kind: "none" },
  };
}

it("delivers retained lookup facts to the existing recovery client without a fabricated filing reply", () => {
  const input = status(evidence);
  const parsed = parseConflictResult(input);
  expect(parsed).toEqual(input);
  expect(parsed).not.toBe(input);
});

it.each([
  { ...evidence, source: "submission" },
  { ...evidence, invoice: null },
  { ...evidence, invoice: { ...evidence.invoice, NIF: "unlisted" } },
  { ...evidence, invoice: { ...evidence.invoice, FechaExpedicionFactura: 20 } },
  { ...evidence, state: "Incorrecto" },
  { ...evidence, fingerprint: 12 },
  { ...evidence, system: { ...evidence.system, taxId: 12 } },
  { ...evidence, system: { ...evidence.system, secret: "unlisted" } },
  { ...evidence, reference: [] },
  { ...evidence, line: {} },
])("refuses malformed or unlisted lookup evidence %j", (value) => {
  expect(parseConflictResult(status(value))).toBeNull();
});

it("retains explicit missing lookup fields as unknown facts", () => {
  const input = status({ ...evidence, fingerprint: null, reference: null, system: null });
  expect(parseConflictResult(input)).toEqual(input);
});
