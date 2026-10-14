import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { eq, sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { invoiceSeries, locations, nodes, stampDeployment, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { persons, startManagementSession } from "@waitron/identity";
import { locationId } from "@waitron/shared";
import { seedTenants, TENANT_A, TENANT_B } from "@waitron/fiscal-verifactu/test/fixtures.js";
import { seedFixtureSif } from "@waitron/fiscal-verifactu/test/sif-fixture.js";
import { allocationFixture } from "@waitron/fiscal-verifactu/test/allocation-fixture.js";
import {
  paperCustodianFingerprint,
  signPaperBlock,
} from "@waitron/fiscal-verifactu/src/paper-evidence.js";
import { startServer, type StartedServer } from "./boot.js";
import { mintBreakGlassSecret } from "./break-glass.js";
import { awaitListening, copyMigrationsRoot } from "./testing/boot-harness.js";
import { freePorts } from "./testing/free-ports.js";

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
const node = { nodeId: TENANT_A.nodeId, locationId: locationId(TENANT_A.locationId) };
const bases = [
  { code: "A", purpose: "standard" },
  { code: "R", purpose: "rectificative" },
  { code: "FF", purpose: "full" },
];

it("the actual trading listener downloads the named node key and signed register without bucket or subscription", async () => {
  await seedTenants(suite.db);
  await suite.db.delete(nodes).where(eq(nodes.id, TENANT_B.nodeId));
  await suite.db.delete(locations).where(eq(locations.id, TENANT_B.locationId));
  await suite.db.update(nodes).set({ filingModule: "verifactu" }).where(eq(nodes.id, node.nodeId));
  await stampDeployment(suite.db, "preproduction");
  await seedFixtureSif(suite.db, {
    nodeId: node.nodeId,
    nif: "89890001K",
    idSistemaInformatico: "W1",
    numeroInstalacion: "S000001",
  });
  await suite.db
    .insert(invoiceSeries)
    .values(bases.map((base) => ({ ...base, code: `${base.code}-S000001`, nodeId: node.nodeId })));
  const token = await withTransaction(suite.db, async (tx) => {
    const [admin] = await tx
      .insert(persons)
      .values({ displayName: "Owner", role: "admin", pinHash: "unused", passwordHash: "unused" })
      .returning();
    return (await startManagementSession(tx, { personId: admin!.id })).token;
  });
  const secret = await mintBreakGlassSecret(suite.db, node.nodeId);
  const fixture = allocationFixture({ node, bases, identity: "P000042" });
  const keys = generateKeyPairSync("ed25519");
  const publicKey = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
  const privateKey = keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const block = signPaperBlock(
    { ...fixture.state.evidence.block.payload, recipientVenueId: node.locationId },
    privateKey,
  );
  const custodian = {
    custodianId: block.payload.custodianId,
    publicKey,
    fingerprint: paperCustodianFingerprint(publicKey),
  };
  const scratch = await mkdtemp(join(tmpdir(), "w41s6-boot-pack-"));
  let server: StartedServer | undefined;
  try {
    await copyMigrationsRoot(join(scratch, "migrations"));
    await writeFile(
      join(scratch, "modules.json"),
      JSON.stringify({ modules: { "fiscal-none": false } }),
    );
    const database = suite.db.all<{ file: string }>(sql`pragma database_list`)[0]!.file;
    const [port] = await freePorts(1);
    server = await startServer({
      WAITRON_VENUE_DIR: dirname(database),
      WAITRON_STATE_DIR: scratch,
      WAITRON_LOG_DIR: join(scratch, "logs"),
      WAITRON_MIGRATIONS_DIR: join(scratch, "migrations"),
      WAITRON_HTTP_PORT: String(port),
      WAITRON_HTTP_LANDING_PORT: "0",
      WAITRON_TILL_NODE_ID: node.nodeId,
      WAITRON_TILL_LOCATION_ID: node.locationId,
      WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 5).toString("base64"),
      WAITRON_CREDENTIALS_KEY_VERSION: "1",
      WAITRON_ENV: "dev",
    });
    await awaitListening(port!);
    const response = await fetch(`http://127.0.0.1:${port}/api/box/recovery-pack`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: `waitron_management_session=${token}`,
      },
      body: JSON.stringify({
        nodeRecoveryKey: secret,
        modules: { "fiscal-verifactu": { block, custodian } },
      }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      kind: "node-recovery-pack",
      nodeRecovery: { nodeId: node.nodeId, name: expect.any(String), secret },
      modules: { "fiscal-verifactu": { kind: "paper-register-snapshot", block, custodian } },
    });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await readFile(join(scratch, "logs", "waitron.log"), "utf8")).not.toContain(secret);
    expect(await readFile(join(scratch, "logs", "waitron.log"), "utf8")).not.toContain(privateKey);
    const incidents = await suite.db.execute(sql`select * from incidents`);
    expect(JSON.stringify(incidents)).not.toContain(secret);
    expect(JSON.stringify(incidents)).not.toContain(privateKey);
  } finally {
    await server?.close();
    await rm(scratch, { recursive: true, force: true });
  }
}, 60_000);
