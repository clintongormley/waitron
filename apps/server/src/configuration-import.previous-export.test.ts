import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { afterEach, expect, it } from "vitest";
import { loadKeyRing } from "@waitron/credentials";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { schemaVersionsByModule } from "./backup-manifest.js";
import { stageConfigurationImport } from "./configuration-import.js";
import {
  decodeConfigurationBundle,
  validateConfigurationBundle,
} from "./configuration-transfer.js";
import { ALL_MODULES } from "./modules.js";
import { mountSetup } from "./setup-api.js";

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

it("refuses the real pre-A261-2 export through setup without writing database rows or staging files", async () => {
  const artifact = await readFile(
    new URL("./testing/fixtures/pre-a261-2-configuration.enc", import.meta.url),
  );
  const bundle = decodeConfigurationBundle(artifact, "a strong passphrase");
  expect(bundle.venue.legalName).toBe("Prepared Export SL");
  expect(bundle.modules.core).toBe(99);
  expect(bundle.tables).not.toHaveProperty("department_sale_policies");
  expect(bundle.tables).not.toHaveProperty("zone_sale_policies");
  const stateDir = await mkdtemp(join(tmpdir(), "waitron-previous-export-"));
  dirs.push(stateDir);
  const ring = loadKeyRing({ WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 17).toString("base64") });
  const versions = await schemaVersionsByModule(suite.db, ALL_MODULES);
  const snapshot = async () => {
    const tables = await suite.db.execute<{ name: string }>(
      sql`select name from sqlite_schema where type = 'table' order by name`,
    );
    const rows: Record<string, unknown> = {};
    for (const table of tables.rows) {
      rows[table.name] = (
        await suite.db.execute(sql`select * from ${sql.identifier(table.name)}`)
      ).rows;
    }
    return rows;
  };
  const before = await snapshot();
  const app = new Hono();
  mountSetup(
    app,
    {
      environment: "preproduction",
      stageConfiguration: (bytes, passphrase) =>
        stageConfigurationImport(stateDir, ring, bytes, passphrase, async (candidate) => {
          validateConfigurationBundle(candidate, ALL_MODULES, versions);
        }),
    },
    () => {},
  );
  const response = await app.request("/setup-api/configuration", {
    method: "POST",
    headers: {
      "content-type": "application/octet-stream",
      "x-waitron-export-passphrase": "a strong passphrase",
    },
    body: Uint8Array.from(artifact).buffer,
  });
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({
    error: { code: "setup.request_invalid", params: { field: "module:core" } },
  });
  expect(await snapshot()).toEqual(before);
  expect(await readdir(stateDir)).toEqual([]);
});
