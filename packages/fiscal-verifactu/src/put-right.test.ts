import { describe, expect, it } from "vitest";
import type { FilingCaseView } from "./filing-overview-types.js";
import { putRightFor } from "./put-right.js";

function refused(
  code: number,
  {
    tipoFactura = "F2",
    mensaje = null,
    mensajeError = null,
  }: { tipoFactura?: string; mensaje?: string | null; mensajeError?: string | null } = {},
): FilingCaseView {
  return {
    registroId: "r1",
    cause: "fiscal.registro_rechazado",
    openedAt: "2026-11-13T10:00:00.000Z",
    evidence: { codigo: code, mensaje, csv: null },
    record: {
      tipoRegistro: "alta",
      idEmisorFactura: "89890001K",
      numSerieFactura: "A/1",
      fechaExpedicionFactura: "13-11-2026",
      tipoFactura,
      importeTotal: "12.10",
      cuotaTotal: "1.10",
      descripcionOperacion: "Venta en establecimiento",
      huella: "H",
      anteriorHuella: null,
      fechaHoraHusoGenRegistro: "2026-11-13T11:00:00+01:00",
      numeroInstalacion: "1",
    },
    submission: {
      estado: "rechazado",
      codigoError: String(code),
      mensajeError,
      enviadoEn: "2026-11-13T10:00:00.000Z",
    },
    conflicts: [],
    lookups: [],
    heldBehind: 0,
  };
}

const DESCRIPTION_MESSAGE = "Valor o tipo incorrecto del campo: DescripcionOperacion";

describe("putRightFor, code 1112 (issue date in the future)", () => {
  it("offers nothing yet for a simplified invoice", () => {
    expect(putRightFor(refused(1112))).toEqual({ kind: "none", why: "not-yet" });
  });
  it.each(["F1", "F3"])("names the full-invoice corrective for %s", (tipoFactura) => {
    expect(putRightFor(refused(1112, { tipoFactura }))).toEqual({
      kind: "none",
      why: "full-invoice",
    });
  });
  it.each(["R1", "R5"])("offers nothing yet for a refused corrective %s", (tipoFactura) => {
    expect(putRightFor(refused(1112, { tipoFactura }))).toEqual({ kind: "none", why: "not-yet" });
  });
});

describe("putRightFor, code 1100 (a field has a wrong value or type)", () => {
  it("offers the correction record when the latest message names DescripcionOperacion", () => {
    expect(putRightFor(refused(1100, { mensajeError: DESCRIPTION_MESSAGE }))).toEqual({
      kind: "record-correction",
    });
  });
  it("ignores case in the field's name", () => {
    expect(
      putRightFor(refused(1100, { mensajeError: "campo descripcionoperacion incorrecto" })),
    ).toEqual({ kind: "record-correction" });
  });
  it("reads the case's opening message when there is no later one", () => {
    expect(putRightFor(refused(1100, { mensaje: DESCRIPTION_MESSAGE }))).toEqual({
      kind: "record-correction",
    });
  });
  it("reads the latest message over the opening one", () => {
    expect(
      putRightFor(
        refused(1100, {
          mensaje: DESCRIPTION_MESSAGE,
          mensajeError: "Valor o tipo incorrecto del campo: NombreRazon",
        }),
      ),
    ).toEqual({ kind: "none", why: "not-yet" });
  });
  it("offers nothing when the message names another field", () => {
    expect(
      putRightFor(
        refused(1100, { mensajeError: "Valor o tipo incorrecto del campo: NombreRazon" }),
      ),
    ).toEqual({ kind: "none", why: "not-yet" });
  });
  it("offers nothing when there is no message", () => {
    expect(putRightFor(refused(1100))).toEqual({ kind: "none", why: "not-yet" });
  });
  it("offers nothing for an empty message", () => {
    expect(putRightFor(refused(1100, { mensajeError: "" }))).toEqual({
      kind: "none",
      why: "not-yet",
    });
  });
  it("offers the correction record for a full invoice too", () => {
    expect(
      putRightFor(refused(1100, { tipoFactura: "F1", mensajeError: DESCRIPTION_MESSAGE })),
    ).toEqual({ kind: "record-correction" });
  });
});

describe("putRightFor, cases no fix applies to", () => {
  const description = refused(1100, { mensajeError: DESCRIPTION_MESSAGE });
  it("offers nothing when the code now differs from the code the case opened with", () => {
    expect(
      putRightFor({
        ...description,
        submission: { ...description.submission!, codigoError: "1104" },
      }),
    ).toEqual({ kind: "none", why: "not-yet" });
  });
  it("offers nothing when the case opened with no code", () => {
    expect(
      putRightFor({ ...description, evidence: { ...description.evidence, codigo: null } }),
    ).toEqual({ kind: "none", why: "not-yet" });
  });
  it("offers nothing for an accepted-with-errors case", () => {
    expect(
      putRightFor({
        ...description,
        cause: "fiscal.aceptado_con_errores",
        submission: { ...description.submission!, estado: "aceptado_con_errores" },
      }),
    ).toEqual({ kind: "none", why: "not-yet" });
  });
  it("offers nothing when the delivery is no longer refused", () => {
    expect(
      putRightFor({
        ...description,
        submission: { ...description.submission!, estado: "pendiente" },
      }),
    ).toEqual({ kind: "none", why: "not-yet" });
  });
  it("offers nothing when the case has no delivery", () => {
    expect(putRightFor({ ...description, submission: null })).toEqual({
      kind: "none",
      why: "not-yet",
    });
  });
  it("offers nothing for a cancellation", () => {
    expect(
      putRightFor({ ...description, record: { ...description.record, tipoRegistro: "anulacion" } }),
    ).toEqual({ kind: "none", why: "not-yet" });
  });
  it("offers nothing for a duplicate (3000)", () => {
    expect(putRightFor(refused(3000, { mensajeError: DESCRIPTION_MESSAGE }))).toEqual({
      kind: "none",
      why: "not-yet",
    });
  });
  it("offers nothing for a full invoice whose cause is not a refusal", () => {
    expect(
      putRightFor({ ...refused(1112, { tipoFactura: "F1" }), cause: "fiscal.huella_divergente" }),
    ).toEqual({ kind: "none", why: "not-yet" });
  });
});
