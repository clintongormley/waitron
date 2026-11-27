import { describe, expect, it } from "vitest";
import { validate, type RespuestaLinea } from "@waitron/verifactu";
import { createFakeAeat } from "@waitron/verifactu/testing";
import {
  inSendWindow,
  madridMinute,
  notSentText,
  outcomeOf,
  probeRecords,
  recordLine,
  resultText,
  verdict,
  type Outcome,
  type ProbeLabel,
} from "./aeat-midnight-probe.js";

const taxpayer = { taxId: "B12345674", legalName: "Probe Deli SL" };
const at2310 = new Date("2026-11-27T23:10:00Z");

function line(estado: string | undefined, code?: number, text?: string): RespuestaLinea {
  return {
    IDFactura: {
      IDEmisorFactura: taxpayer.taxId,
      NumSerieFactura: "X",
      FechaExpedicionFactura: "28-11-2026",
    },
    EstadoRegistro: estado,
    ...(code === undefined ? {} : { CodigoErrorRegistro: code }),
    ...(text === undefined ? {} : { DescripcionErrorRegistro: text }),
  };
}

const accepted: Outcome = { kind: "accepted", status: "Correcto" };
const refused: Outcome = { kind: "1112", status: "Incorrecto", code: 1112 };
const other: Outcome = { kind: "other", status: "Incorrecto", code: 4102 };

function outcomes(
  control: Outcome,
  madridDay: Outcome,
  ownOffset: Outcome,
  future: Outcome,
): Record<ProbeLabel, Outcome> {
  return { control, "madrid-day": madridDay, "own-offset": ownOffset, future };
}

describe("the send window", () => {
  it.each([
    ["2026-11-27T23:04:59Z", false],
    ["2026-11-27T23:05:00Z", true],
    ["2026-11-27T23:54:59Z", true],
    ["2026-11-27T23:55:00Z", false],
    ["2026-11-27T12:00:00Z", false],
  ])("at %s UTC is %s", (instant, expected) => {
    expect(inSendWindow(new Date(instant))).toBe(expected);
  });

  it("reads Madrid's clock, in summer too", () => {
    expect(madridMinute(new Date("2026-11-27T23:10:00Z"))).toBe(10);
    expect(madridMinute(new Date("2026-07-01T22:30:00Z"))).toBe(30);
  });
});

describe("the four records at 23:10 UTC on 27 November", () => {
  const records = probeRecords(at2310, taxpayer);
  const byLabel = Object.fromEntries(records.map((entry) => [entry.label, entry]));

  it("are sent in order with the dates the question needs", () => {
    expect(records.map((entry) => entry.label)).toEqual([
      "control",
      "madrid-day",
      "own-offset",
      "future",
    ]);
    expect(
      records.map((entry) => [
        entry.record.IDFactura.FechaExpedicionFactura,
        entry.record.FechaHoraHusoGenRegistro,
      ]),
    ).toEqual([
      ["27-11-2026", "2026-11-28T00:10:00+01:00"],
      ["28-11-2026", "2026-11-28T00:10:00+01:00"],
      ["28-11-2026", "2026-11-27T23:10:00+00:00"],
      ["29-11-2026", "2026-11-28T00:10:00+01:00"],
    ]);
  });

  it("are each a first record of their own installation, numbered per run", () => {
    for (const entry of records) {
      const number = `A1270-202611272310-${entry.label}`;
      expect(entry.record.IDFactura.NumSerieFactura).toBe(number);
      expect(entry.record.SistemaInformatico.NumeroInstalacion).toBe(number);
      expect(entry.record.Encadenamiento).toEqual({ PrimerRegistro: "S" });
      expect(entry.record.SistemaInformatico).toMatchObject({
        NombreSistemaInformatico: "A1270 probe",
        IdSistemaInformatico: "PB",
        NIF: taxpayer.taxId,
        NombreRazon: taxpayer.legalName,
      });
      expect(entry.record).toMatchObject({
        TipoFactura: "F2",
        CuotaTotal: "0.21",
        ImporteTotal: "1.21",
        NombreRazonEmisor: taxpayer.legalName,
      });
      expect(entry.record.IDFactura.IDEmisorFactura).toBe(taxpayer.taxId);
    }
  });

  it("find only the dates the library itself thinks are ahead of the record's own offset", () => {
    const codes = (label: string) =>
      validate(byLabel[label]!.record, { now: at2310 }).map((issue) => issue.code);
    expect(codes("control")).toEqual([]);
    expect(codes("madrid-day")).toEqual([]);
    // The library reads "today" in the record's own offset, so the UTC-written Madrid date is
    // ahead of it; that is the reading the own-offset record tests at AEAT.
    expect(codes("own-offset")).toEqual(["FECHA_EXPEDICION_FUTURE"]);
    expect(codes("future")).toEqual(["FECHA_EXPEDICION_FUTURE"]);
  });

  it("include one the fake AEAT refuses, since it compares in UTC", async () => {
    const fake = createFakeAeat({ serverNow: at2310 });
    const cabecera = {
      ObligadoEmision: { NombreRazon: taxpayer.legalName, NIF: taxpayer.taxId },
    };
    const answer = await fake
      .client()
      .submit(cabecera, [{ RegistroAlta: byLabel["madrid-day"]!.record }]);
    expect(outcomeOf(answer.RespuestaLinea[0])).toMatchObject({ kind: "1112", code: 1112 });
  });

  it("follow Madrid's offset in summer", () => {
    const summer = probeRecords(new Date("2026-07-01T22:10:00Z"), taxpayer);
    expect(summer.map((entry) => entry.record.IDFactura.FechaExpedicionFactura)).toEqual([
      "01-07-2026",
      "02-07-2026",
      "02-07-2026",
      "03-07-2026",
    ]);
  });
});

describe("an outcome", () => {
  it("is accepted for Correcto and AceptadoConErrores", () => {
    expect(outcomeOf(line("Correcto"))).toEqual({ kind: "accepted", status: "Correcto" });
    expect(outcomeOf(line("AceptadoConErrores", 2004, "warn"))).toEqual({
      kind: "accepted",
      status: "AceptadoConErrores",
      code: 2004,
      text: "warn",
    });
  });

  it("is 1112 only for Incorrecto with that code", () => {
    expect(outcomeOf(line("Incorrecto", 1112)).kind).toBe("1112");
    expect(outcomeOf(line("Incorrecto", 3000)).kind).toBe("other");
    expect(outcomeOf(line("Desconocido", 1112)).kind).toBe("other");
  });

  it("is other with no line or a transport error", () => {
    expect(outcomeOf(undefined)).toEqual({ kind: "other", status: "no line" });
    expect(outcomeOf(line(undefined))).toEqual({ kind: "other", status: "no status" });
    expect(outcomeOf(new Error("socket hang up"))).toEqual({
      kind: "other",
      status: "error",
      text: "socket hang up",
    });
  });
});

describe("the verdict", () => {
  it.each([refused, accepted, other])(
    "says UTC when the Madrid date is refused, whatever own-offset got (%o)",
    (ownOffset) => {
      expect(verdict(outcomes(accepted, refused, ownOffset, refused))).toBe(
        "AEAT refused today's Madrid date at 00:10 Madrid: it compares in UTC, as the fake does",
      );
    },
  );

  it("says Madrid when both spellings of the Madrid date are accepted", () => {
    expect(verdict(outcomes(accepted, accepted, accepted, refused))).toBe(
      "AEAT accepted today's Madrid date at 00:10 Madrid, also when the record said UTC: it compares with its own Madrid date (or UTC with at least 50 minutes' leeway)",
    );
  });

  it("says own offset when only the UTC spelling is refused", () => {
    expect(verdict(outcomes(accepted, accepted, refused, refused))).toBe(
      "AEAT accepted the Madrid date but refused the same date written in UTC: it reads the date in the record's own offset",
    );
  });

  it.each([
    ["control refused", outcomes(refused, refused, refused, refused)],
    ["future accepted", outcomes(accepted, accepted, accepted, accepted)],
    ["another code", outcomes(accepted, other, refused, refused)],
    ["own-offset other", outcomes(accepted, accepted, other, refused)],
  ])("is inconclusive with %s, naming each record", (_name, given) => {
    const text = verdict(given);
    expect(text).toMatch(/^Inconclusive: control \S+, madrid-day \S+, own-offset \S+, future \S+$/);
  });
});

describe("the result text", () => {
  const records = probeRecords(at2310, taxpayer);
  const masked = outcomeOf(
    line(
      "Incorrecto",
      1112,
      `NIF ${taxpayer.taxId} (${taxpayer.legalName.toUpperCase()}): superior a la fecha actual`,
    ),
  );

  it("lists each record and the verdict, never the tax number or the legal name", () => {
    const results = records.map((entry) => ({ entry, outcome: masked }));
    const text = resultText(at2310, results, taxpayer);
    expect(text).toContain("sent 2026-11-27T23:10:00.000Z UTC, 00:10 Madrid");
    expect(text).toContain(
      "madrid-day A1270-202611272310-madrid-day date 28-11-2026 generated 2026-11-28T00:10:00+01:00: 1112 Incorrecto 1112",
    );
    expect(text).toContain("NIF *** (***): superior a la fecha actual");
    expect(text).toContain("Inconclusive:");
    expect(text).not.toContain(taxpayer.taxId);
    expect(text.toLowerCase()).not.toContain(taxpayer.legalName.toLowerCase());
  });

  it("leaves text alone when a setting to mask is empty", () => {
    expect(notSentText(at2310, "no tax number", { taxId: "", legalName: " " })).toBe(
      "not sent at 2026-11-27T23:10:00.000Z UTC, 00:10 Madrid: no tax number",
    );
  });

  it("writes one record's line on its own", () => {
    expect(recordLine({ entry: records[0]!, outcome: accepted }, taxpayer)).toBe(
      "control A1270-202611272310-control date 27-11-2026 generated 2026-11-28T00:10:00+01:00: accepted Correcto",
    );
  });

  it("says not sent, with the Madrid time and the reason, masked", () => {
    expect(notSentText(at2310, `dry run for ${taxpayer.taxId}`, taxpayer)).toBe(
      "not sent at 2026-11-27T23:10:00.000Z UTC, 00:10 Madrid: dry run for ***",
    );
  });
});
