import { beforeAll, describe, expect, it } from "vitest";
import { locations, nodes } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { nodeId as brandNodeId } from "@waitron/shared";
import type { NodeId } from "@waitron/shared";
import { readFilingModule } from "./till-config.js";

// PGlite (superuser) is enough: this proves the column read and the null case, not the role path
// — `readOrderFlow`, its sibling, is proven under the app role by the boot suites.
const suite = useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
});

let stamped: NodeId;
let bare: NodeId;

beforeAll(async () => {
  await seedTenant(suite.db);
  // Through the table definitions: `locations.id`, `nodes.id` and `nodes.created_at` are JavaScript
  // `$defaultFn` generators on this engine, which a raw insert never reaches, and the locale list is
  // encoded by the column's own write mapping — the `array[...]` constructor it replaces is a syntax
  // error here. The two `nodes` rows keep exactly the columns they carried: `stamped` names both
  // module columns and `bare` names neither, which is what the null case under test turns on. No
  // chain, series or `registros_facturacion` row is touched by this fixture.
  const [loc] = await suite.db
    .insert(locations)
    .values({
      name: "Barra",
      invoiceLocales: ["es-ES"],
      operationDescription: "Venta en establecimiento",
    })
    .returning({ id: locations.id });
  const locationId = loc!.id;
  const [s] = await suite.db
    .insert(nodes)
    .values({ locationId, name: "stamped", filingModule: "verifactu", taxModule: "vat" })
    .returning({ id: nodes.id });
  const [b] = await suite.db
    .insert(nodes)
    .values({ locationId, name: "bare" })
    .returning({ id: nodes.id });
  stamped = brandNodeId(s!.id);
  bare = brandNodeId(b!.id);
});

describe("readFilingModule", () => {
  it("reads the node's stamped filing module", async () => {
    expect(await readFilingModule(suite.db, { nodeId: stamped })).toBe("verifactu");
  });
  it("is null for a node provisioning never stamped", async () => {
    expect(await readFilingModule(suite.db, { nodeId: bare })).toBeNull();
  });
});
