import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { adoptVenue, type AdoptResult, type AdoptVenueRows } from "./venue-adopt.js";

// PGlite is sufficient here for the same reason as `venue-adopt.test.ts`:
// this suite is about WHICH tables `adoptVenue` writes, not about the role that writes them. CORE →
// IDENTITY → FISCAL so `registro_sif`/`cadenas`/`contadores_instalacion` exist to be counted.
const suite = usePgliteDb({
  migrations: migrationOptionsFor(manifestSets(), null),
});

function makeRows(): { rows: AdoptVenueRows; designated: AdoptResult } {
  const tenantId = randomUUID();
  const locationId = randomUUID();
  const nodeId = randomUUID();
  const tillId = randomUUID();
  const seriesId = randomUUID();

  const rows: AdoptVenueRows = {
    tenant: { id: tenantId, country: "ES", taxId: "B87654321", legalName: "Primary SL" },
    locations: [
      {
        id: locationId,
        tenantId,
        name: "Mostrador",
        invoiceLocales: ["es-ES"],
        operationDescription: "venta en establecimiento",
      },
    ],
    nodes: [{ id: nodeId, tenantId, locationId, name: "Node 1" }],
    tills: [{ id: tillId, tenantId, locationId, name: "Caja 1" }],
    invoiceSeries: [{ id: seriesId, tenantId, nodeId, code: "A" }],
  };

  return { rows, designated: { tenantId, locationId, tillId, nodeId, seriesId } };
}

describe("adoptVenue — the unrepairable-chain guardrail", () => {
  // The whole point of `adoptVenue`: a mirror must NEVER re-register the SIF. `registerSif` mints a
  // fresh installation number and NULLs the chain-head pointer, forking a SECOND unrecoverable hash
  // chain for the same venue (CLAUDE.md §5, spec §5). Those rows arrive on the mirror through SYNC,
  // never from provisioning — so after adopt these three tables must be empty.
  //
  // PROVEN BY DELETION (CLAUDE.md §4): temporarily running the fiscal module's provisioning seed
  // (`FISCAL_PROVISIONING.seed.run`, the same one `applyVenue` runs for a fresh node) inside
  // `adoptVenue` makes this fail with `registro_sif` count = 1; removing it makes it pass.
  it("writes NO registro_sif / cadenas / contadores_instalacion row", async () => {
    const { rows, designated } = makeRows();
    await adoptVenue(rows, designated, { db: suite.db });

    for (const table of ["registro_sif", "cadenas", "contadores_instalacion"]) {
      const r = await suite.db.execute<{ n: number }>(
        sql.raw(`select count(*)::int as n from ${table}`),
      );
      expect(r.rows[0].n, `${table} must be empty after adopt`).toBe(0);
    }
  });
});
