import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { nodeId as brandNodeId } from "@waitron/shared";
import type { NodeId } from "@waitron/shared";
import { readFilingModule } from "./till-config.js";

// PGlite (superuser) is enough: this proves the column read and the null case, not the role path
// — `readOrderFlow`, its sibling, is proven under the app role by the boot suites.
const suite = usePgliteDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
});

let stamped: NodeId;
let bare: NodeId;

beforeAll(async () => {
  await seedTenant(suite.db);
  const loc = await suite.db.execute<{ id: string }>(sql`
    insert into locations (name, invoice_locales, operation_description)
    values ('Barra', array['es-ES'], 'Venta en establecimiento') returning id`);
  const locationId = loc.rows[0]!.id;
  const s = await suite.db.execute<{ id: string }>(sql`
    insert into nodes (location_id, name, filing_module, tax_module)
    values (${locationId}, 'stamped', 'verifactu', 'vat') returning id`);
  const b = await suite.db.execute<{ id: string }>(sql`
    insert into nodes (location_id, name) values (${locationId}, 'bare') returning id`);
  stamped = brandNodeId(s.rows[0]!.id);
  bare = brandNodeId(b.rows[0]!.id);
});

describe("readFilingModule", () => {
  it("reads the node's stamped filing module", async () => {
    expect(await readFilingModule(suite.db, { nodeId: stamped })).toBe("verifactu");
  });
  it("is null for a node provisioning never stamped", async () => {
    expect(await readFilingModule(suite.db, { nodeId: bare })).toBeNull();
  });
});
