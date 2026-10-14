import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterAll, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { CORE_MIGRATIONS, locations, nodes, tenants, stampDeployment } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { fakeModule } from "@waitron/module/src/testing/fake-module.js";
import { encryptArtifact } from "./artifact-cipher.js";
import { packArchive } from "./backup-archive.js";
import { previewRecoveryArchive } from "./recovery-backup-preview.js";

const prefix = mkdtempSync(join(tmpdir(), "preview-old-schema-"));
mkdirSync(join(prefix, "meta"));
const journal = JSON.parse(
  readFileSync(join(CORE_MIGRATIONS.migrationsFolder, "meta/_journal.json"), "utf8"),
) as {
  entries: { tag: string }[];
};
journal.entries = journal.entries.slice(
  0,
  journal.entries.findIndex((entry) => entry.tag.startsWith("0151_")),
);
for (const entry of journal.entries)
  copyFileSync(
    join(CORE_MIGRATIONS.migrationsFolder, `${entry.tag}.sql`),
    join(prefix, `${entry.tag}.sql`),
  );
writeFileSync(join(prefix, "meta/_journal.json"), JSON.stringify(journal));
const suite = useVenueDb({ migrations: [{ ...CORE_MIGRATIONS, migrationsFolder: prefix }] });
afterAll(() => rmSync(prefix, { recursive: true, force: true }));

it("previews a backup predating named keys by migrating only its private scratch copy", async () => {
  const nodeId = "d0000000-0000-4000-8000-000000000001";
  const locationId = "d0000000-0000-4000-8000-000000000002";
  await stampDeployment(suite.db, "preproduction");
  await suite.db
    .insert(tenants)
    .values({ id: 1, country: "ES", taxId: "89890001K", legalName: "Earlier venue" });
  await suite.db.insert(locations).values({
    id: locationId,
    name: "Earlier location",
    invoiceLocales: ["es-ES"],
    operationDescription: "Restaurant",
  });
  await suite.db.insert(nodes).values({ id: nodeId, locationId, name: "Earlier node" });
  const scratch = await mkdtemp(join(tmpdir(), "preview-old-archive-"));
  try {
    const source = join(scratch, "source.db");
    await suite.db.archiveTo(source);
    const sourceBytes = await readFile(source);
    const artifact = encryptArtifact(
      packArchive([
        {
          name: "manifest.json",
          bytes: Buffer.from(
            JSON.stringify({
              manifestVersion: 1,
              createdAt: "2026-10-01T08:00:00.000Z",
              environment: "preproduction",
              modules: { core: journal.entries.length },
            }),
          ),
        },
        { name: "db.dump", bytes: sourceBytes },
        {
          name: "secrets/trading.env",
          bytes: Buffer.from(
            `WAITRON_TILL_NODE_ID=${nodeId}\nWAITRON_TILL_LOCATION_ID=${locationId}\n`,
          ),
        },
        { name: "secrets/node-key.enc", bytes: Buffer.from("sealed") },
        { name: "secrets/cluster-id", bytes: Buffer.from("cluster") },
        {
          name: "secrets/credentials.key",
          bytes: Buffer.from(Buffer.alloc(32, 7).toString("base64")),
        },
      ]),
      "archive-encryption-key",
    );
    const preview = await previewRecoveryArchive({
      artifact,
      recoveryKey: "archive-encryption-key",
      environment: "preproduction",
      stateDir: scratch,
      stagingDir: scratch,
      migrationsRoot: null,
      modules: [
        {
          ...fakeModule("core"),
          migrations: { name: "core", table: "__drizzle_migrations_db", from: "../db/drizzle" },
        },
      ],
    });
    expect(preview.nodeRecoveryKeyName).toBeNull();
    expect(preview.taxpayer).toEqual({ legalName: "Earlier venue", taxId: "89890001K" });
    expect(preview.locationName).toBe("Earlier location");
    expect(await readFile(source)).toEqual(sourceBytes);
    expect(
      suite.db
        .all<{ name: string }>(sql`pragma table_info(node_roles)`)
        .map((column) => column.name),
    ).not.toContain("break_glass_key_name");
    expect(await readdir(scratch)).toEqual(["source.db"]);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});
