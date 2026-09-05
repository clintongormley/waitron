import { describe, expect, it } from "vitest";
import { FISCAL_ENROLMENT } from "./enrolment.js";

describe("FISCAL_ENROLMENT", () => {
  const byTable = new Map(FISCAL_ENROLMENT.map((e) => [e.table, e]));

  it("enrols exactly the six fiscal tables on the ordered lane", () => {
    expect([...byTable.keys()].sort()).toEqual(
      ["acks", "cadenas", "envio_flujo", "envios", "registro_sif", "registros_facturacion"].sort(),
    );
    for (const e of FISCAL_ENROLMENT) expect(e.lane).toBe("ordered");
  });

  it("makes the immutable ledger insert-only and captures verbatim columns", () => {
    const r = byTable.get("registros_facturacion")!;
    expect(r.mode).toBe("insert-only");
    expect(r.conflictKey).toEqual(["id"]);
    expect(r.watermarkColumn).toBeNull();
    expect(r.captureOps).toEqual(["insert"]);
    // columns are DERIVED from the Drizzle table by enrol() — assert the verbatim-critical ones ride.
    for (const col of ["huella", "anterior_huella", "entorno", "sistema_informatico"]) {
      expect(r.columns).toContain(col);
    }
  });

  it("keys the chain head on (tenant_id, node_id) with the actualizado_en watermark", () => {
    const c = byTable.get("cadenas")!;
    expect(c.mode).toBe("watermark-upsert");
    expect(c.conflictKey).toEqual(["tenant_id", "node_id"]);
    expect(c.watermarkColumn).toBe("actualizado_en");
  });

  it("makes acks the one fiscal table that deletes", () => {
    expect(byTable.get("acks")!.captureOps).toEqual(["insert", "update", "delete"]);
    // the other four mutable tables update but never delete
    for (const t of ["registro_sif", "envios", "envio_flujo", "cadenas"]) {
      expect(byTable.get(t)!.captureOps).toEqual(["insert", "update"]);
    }
  });
});
