import { describe, expect, it } from "vitest";
import {
  ALL_CLASSIFICATIONS,
  ALL_MODULES,
  LEDGER_PUBLICATION_TABLES,
  STATE_PUBLICATION_TABLES,
  VENUE_SERVICE,
} from "./modules.js";

describe("venue-service assembly", () => {
  it("injects the composed contribution through the generic module seat", () => {
    expect(VENUE_SERVICE).toBe(ALL_MODULES.find((module) => module.venueService)?.venueService);
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
  });
  it("puts state tables only in the state publication", () => {
    expect(STATE_PUBLICATION_TABLES).toContain("tenants");
    expect(STATE_PUBLICATION_TABLES).toContain("canvases");
    expect(STATE_PUBLICATION_TABLES).toContain("contadores_instalacion");
    expect(STATE_PUBLICATION_TABLES).not.toContain("sales");
  });
  it("keeps local tables out of both publications", () => {
    for (const local of ["deployment", "scheduled_runs", "sessions"]) {
      expect(LEDGER_PUBLICATION_TABLES).not.toContain(local);
      expect(STATE_PUBLICATION_TABLES).not.toContain(local);
    }
  });
});
