import { expect, it } from "vitest";
import { parseConflictRequest, parseConflictResult } from "./conflict-recovery-contract.js";

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

it("accepts a lookup-only conflict reference without made-up record or case ids", () => {
  const rest = Object.fromEntries(
    Object.entries(status(evidence).active[0]!).filter(
      ([key]) => key !== "registroId" && key !== "caseId",
    ),
  );
  const active = { ...rest, lookupId: "outside-observation" };
  const input = { kind: "status", active: [active], event: { kind: "none" } };
  expect(parseConflictResult(input)).toEqual(input);
  const request = {
    recoveryKey: "current-key",
    eventId: "event",
    oldMachineOffline: true,
    noParallelRecovery: true,
    command: { kind: "prepare", proposal: { action: "clock-challenge" } },
    conflict: { lookupId: "outside-observation", sifId: "sif" },
  };
  expect(parseConflictRequest(request)).toEqual(request);
  expect(
    parseConflictRequest({
      ...request,
      conflict: { ...request.conflict, registroId: "record", caseId: "case" },
    }),
  ).toBeNull();
  expect(
    parseConflictResult({
      ...input,
      active: [{ ...active, registroId: "record", caseId: "case" }],
    }),
  ).toBeNull();
});
