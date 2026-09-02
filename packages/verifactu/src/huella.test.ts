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
import { SISTEMA } from "../test/fixtures.js";
import {
  buildCadenaAlta,
  buildCadenaAnulacion,
  computeHuella,
  huellaAnteriorOf,
  verifyHuella,
} from "./huella.js";
import type { Encadenamiento, RegistroAlta, RegistroAnulacion } from "./types.js";

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
    expect(computeHuella(altaRecord(VECTOR_1_INPUT, { PrimerRegistro: "S" }))).toBe(
      VECTOR_1_HUELLA,
    );
  });

  it("matches vector 2 — alta chained to vector 1", () => {
    expect(computeHuella(altaRecord(VECTOR_2_INPUT, previous(VECTOR_1_HUELLA)))).toBe(
      VECTOR_2_HUELLA,
    );
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

describe("till_id is not part of the huella (SP-A.2 §16.4(a))", () => {
  // The H2 fiscal receipt for the SP-A.2 device-unification cutover (spec §16.4(a)). A sale's
  // `till_id` moved from an env value (`WAITRON_TILL_TILL_ID`) to the authenticated device's assigned
  // `tills` row (`requireSaleTillId`, apps/server/src/device-session.ts). That is a change to a piece
  // of SALE METADATA only — `till_id` is stored on `sales.till_id` and snapshotted on
  // `registros_facturacion.till_id`, and is NEVER a huella input. This block is the structural half of
  // the receipt: the canonical string the huella hashes is built from exactly the eight alta fields
  // (`CadenaAltaInput`, types.ts:197) and five anulación fields (`CadenaAnulacionInput`, types.ts:209),
  // and `till_id` is none of them. The §5 invariant "never put our own metadata into a hash" — the
  // same one the `entorno`-identity and `parent_line_id` tests pin — applied to `till_id`.
  //
  // Failing case (what makes this meaningful, per §16.4): if `till_id` entered `buildCadena`, two
  // records differing only in `till_id` would hash DIFFERENTLY, and the two assertions below would
  // fail. Proven by mutation for the H2 receipt: temporarily appending `["TillId", …]` to
  // `buildCadenaAlta`'s `joinCampos` array turns the AEAT official-vector tests and the identity
  // assertions here RED (captured verbatim in the Task 16 receipt), then reverted.

  it("names no till field in either canonical string", () => {
    // Structural: the built canonical strings carry only their fixed field names. `till_id` (in any
    // spelling) never appears, so it cannot reach `computeHuella`'s SHA-256 input.
    expect(buildCadenaAlta(VECTOR_1_INPUT).toLowerCase()).not.toContain("till");
    expect(buildCadenaAnulacion(VECTOR_3_INPUT).toLowerCase()).not.toContain("till");
  });

  it("hashes two alta records that differ only in a carried till_id identically", () => {
    // The `entorno`-identity analog for `till_id` (CLAUDE.md §5). `RegistroAlta` has no `till_id`
    // field at all (types.ts:136) — it is sale metadata that lives on `sales`/`registros_facturacion`,
    // not on the AEAT record — so a `till_id` carried ALONGSIDE the record (the widest shape a
    // regression could leak) is spread on and cast. `computeHuella` reads only the eight hashed
    // fields, so both hash to the same published vector.
    const record = altaRecord(VECTOR_1_INPUT, { PrimerRegistro: "S" });
    expect(computeHuella({ ...record, tillId: "till-X" } as RegistroAlta)).toBe(VECTOR_1_HUELLA);
    expect(computeHuella({ ...record, tillId: "till-Y" } as RegistroAlta)).toBe(VECTOR_1_HUELLA);
  });

  it("hashes two anulación records that differ only in a carried till_id identically", () => {
    const record = anulacionRecord(VECTOR_3_INPUT, previous(VECTOR_2_HUELLA));
    expect(computeHuella({ ...record, tillId: "till-X" } as RegistroAnulacion)).toBe(
      VECTOR_3_HUELLA,
    );
    expect(computeHuella({ ...record, tillId: "till-Y" } as RegistroAnulacion)).toBe(
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
    expect(verifyHuella({ ...record, ImporteTotal: "999.99", Huella: VECTOR_1_HUELLA })).toBe(
      false,
    );
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

  it("rejects PrimerRegistro and RegistroAnterior both present, at the type level", () => {
    // Encadenamiento is an XSD xsd:choice: exactly one branch, never both. There
    // is no runtime guard for this (unlike DetalleDesglose's DESGLOSE_CHOICE),
    // so the only way to assert the constraint is that the invalid shape fails
    // to compile — a type-level test, which is what this is.
    // @ts-expect-error - PrimerRegistro and RegistroAnterior are mutually exclusive.
    const both: Encadenamiento = { PrimerRegistro: "S", ...previous(VECTOR_1_HUELLA) };
    expect(both).toBeDefined();
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
    Desglose: [
      {
        CalificacionOperacion: "S1",
        BaseImponibleOimporteNoSujeto: "111.10",
        CuotaRepercutida: "12.35",
      },
    ],
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
