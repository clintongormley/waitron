import { describe, expect, it } from "vitest";
import {
  ALL_CLASSIFICATIONS,
  ALL_SYNC_ENROLMENTS,
  LEDGER_PUBLICATION_TABLES,
  MODULE_BY_TABLE,
  STATE_PUBLICATION_TABLES,
} from "./modules.js";

describe("MODULE_BY_TABLE", () => {
  it("maps every enrolled table to its owning module", () => {
    expect(MODULE_BY_TABLE.get("sales")).toBe("core");
    expect(MODULE_BY_TABLE.get("ticket_items")).toBe("core");
    expect(MODULE_BY_TABLE.get("persons")).toBe("identity");
    expect(MODULE_BY_TABLE.get("webauthn_credentials")).toBe("identity");
    expect(MODULE_BY_TABLE.get("payments")).toBe("payments");
    expect(MODULE_BY_TABLE.get("payment_policy")).toBe("payments");
  });
  it("covers exactly the assembled enrolment's tables", () => {
    expect([...MODULE_BY_TABLE.keys()].sort()).toEqual(
      ALL_SYNC_ENROLMENTS.map((e) => e.table).sort(),
    );
    expect(MODULE_BY_TABLE.size).toBe(ALL_SYNC_ENROLMENTS.length); // 28, no duplicate table
  });
});

describe("classification assembly", () => {
  it("classifies each table exactly once", () => {
    const names = ALL_CLASSIFICATIONS.map((c) => c.table);
    expect(new Set(names).size).toBe(names.length);
  });
  it("puts ledger tables only in the ledger publication", () => {
    expect(LEDGER_PUBLICATION_TABLES).toContain("sales");
    expect(LEDGER_PUBLICATION_TABLES).toContain("registros_facturacion");
    expect(LEDGER_PUBLICATION_TABLES).not.toContain("tenants");
    expect(LEDGER_PUBLICATION_TABLES).not.toContain("sync_log");
  });
  it("puts state tables only in the state publication", () => {
    expect(STATE_PUBLICATION_TABLES).toContain("tenants");
    expect(STATE_PUBLICATION_TABLES).toContain("canvases");
    expect(STATE_PUBLICATION_TABLES).toContain("contadores_instalacion");
    expect(STATE_PUBLICATION_TABLES).not.toContain("sales");
  });
  it("keeps local tables out of both publications", () => {
    for (const local of ["deployment", "sync_log", "scheduled_runs", "sessions"]) {
      expect(LEDGER_PUBLICATION_TABLES).not.toContain(local);
      expect(STATE_PUBLICATION_TABLES).not.toContain(local);
    }
  });
});
