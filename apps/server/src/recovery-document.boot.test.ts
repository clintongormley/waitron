import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Agent } from "undici";
import { eq, sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import {
  invoiceSeries,
  locations,
  nodes,
  readBreakGlassVerifier,
  stampDeployment,
  withTransaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { persons, startManagementSession, verifySecretAsync } from "@waitron/identity";
import { locationId } from "@waitron/shared";
import { seedTenants, TENANT_A, TENANT_B } from "@waitron/fiscal-verifactu/test/fixtures.js";
import { seedFixtureSif } from "@waitron/fiscal-verifactu/test/sif-fixture.js";
import { startServer, type StartedServer } from "./boot.js";
import { mintBreakGlassSecret } from "./break-glass.js";
import { copyMigrationsRoot } from "./testing/boot-harness.js";
import { freePorts } from "./testing/free-ports.js";
import { ensureBoxSecrets } from "./box-secrets.js";

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
const node = { nodeId: TENANT_A.nodeId, locationId: locationId(TENANT_A.locationId) };
it("the real HTTPS trading listener replaces a lost key, includes retained recovery codes and retains identical reprints", async () => {
  await seedTenants(suite.db);
  await suite.db.delete(nodes).where(eq(nodes.id, TENANT_B.nodeId));
  await suite.db.delete(locations).where(eq(locations.id, TENANT_B.locationId));
  await suite.db.update(nodes).set({ filingModule: "verifactu" }).where(eq(nodes.id, node.nodeId));
  await stampDeployment(suite.db, "preproduction");
  await seedFixtureSif(suite.db, {
    nodeId: node.nodeId,
    nif: "89890001K",
    idSistemaInformatico: "W1",
    numeroInstalacion: "06RB",
  });
  await suite.db.insert(invoiceSeries).values(
    [
      { code: "A-06RB", purpose: "standard" as const },
      { code: "FF-06RB", purpose: "full" as const },
      { code: "R-06RB", purpose: "rectificative" as const },
    ].map((base) => ({ ...base, nodeId: node.nodeId, nextNumber: 123 })),
  );
  const token = await withTransaction(suite.db, async (tx) => {
    const [admin] = await tx
      .insert(persons)
      .values({ displayName: "Owner", role: "manager", pinHash: "unused", passwordHash: "unused" })
      .returning();
    return (await startManagementSession(tx, { personId: admin!.id })).token;
  });
  const oldKey = await mintBreakGlassSecret(suite.db, node.nodeId);
  const oldVerifier = await readBreakGlassVerifier(suite.db, node.nodeId);
  const scratch = await mkdtemp(join(tmpdir(), "manager-recovery-pdf-"));
  let server: StartedServer | undefined, agent: Agent | undefined;
  try {
    await copyMigrationsRoot(join(scratch, "migrations"));
    await ensureBoxSecrets({ stateDir: scratch, hostnames: ["localhost"], now: () => new Date() });
    await writeFile(
      join(scratch, "modules.json"),
      JSON.stringify({ modules: { "fiscal-none": false } }),
    );
    const prepared = {
      reference: "prepared-hours",
      complete: true,
      records: [
        {
          reference: "restored-sheet/06RC",
          kind: "backup",
          taxpayerNif: "89890001K",
          environment: "preproduction",
          softwareId: "W2",
          nodeId: "retired-node",
          identity: "06RC",
          recordedAtMs: null,
        },
      ],
    };
    await mkdir(join(scratch, "module-evidence/fiscal-verifactu"), { recursive: true });
    const historyPath = join(scratch, "module-evidence/fiscal-verifactu/hour-history.json");
    await writeFile(historyPath, JSON.stringify(prepared));
    const originalHistory = await readFile(historyPath);
    const database = suite.db.all<{ file: string }>(sql`pragma database_list`)[0]!.file;
    const [port] = await freePorts(1);
    const env = {
      WAITRON_VENUE_DIR: dirname(database),
      WAITRON_STATE_DIR: scratch,
      WAITRON_LOG_DIR: join(scratch, "logs"),
      WAITRON_MIGRATIONS_DIR: join(scratch, "migrations"),
      WAITRON_HTTP_HOST: "127.0.0.1",
      WAITRON_HTTP_PORT: String(port),
      WAITRON_HTTP_LANDING_PORT: "0",
      WAITRON_TILL_NODE_ID: node.nodeId,
      WAITRON_TILL_LOCATION_ID: node.locationId,
      WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 5).toString("base64"),
      WAITRON_CREDENTIALS_KEY_VERSION: "1",
      WAITRON_ENV: "preproduction",
    };
    server = await startServer(env);
    agent = new Agent({ connect: { ca: await readFile(join(scratch, "tls/ca.crt")) } });
    const post = (path: string, body: unknown) =>
      fetch(`https://127.0.0.1:${port}/api/box/recovery-document/${path}`, {
        dispatcher: agent,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          cookie: `waitron_management_session=${token}`,
        },
        body: JSON.stringify(body),
      } as RequestInit);
    const response = await post("reissue", { locale: "es" });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const bytes = new Uint8Array(await response.arrayBuffer());
    const task = getDocument({
      data: bytes.slice(),
      useSystemFonts: false,
      disableFontFace: true,
      useWorkerFetch: false,
      useWasm: false,
    });
    let key: string;
    try {
      const pdf = await task.promise;
      const document = JSON.parse(
        Buffer.from((await pdf.getAttachmentContent("waitron-recovery-key-v1.json"))!).toString(
          "utf8",
        ),
      );
      expect(document.installationCodes).toEqual(["06RB"]);
      expect(document.nodeKey.nodeId).toBe(node.nodeId);
      key = document.nodeKey.secret;
    } finally {
      await task.destroy();
    }
    const repeat = await post("download", {
      documentId: response.headers.get("x-waitron-recovery-document"),
    });
    expect(repeat.status).toBe(200);
    expect(new Uint8Array(await repeat.arrayBuffer())).toEqual(bytes);
    await server.close();
    server = undefined;
    const verifier = await readBreakGlassVerifier(suite.db, node.nodeId);
    expect(await verifySecretAsync(key!, verifier!)).toBe(true);
    expect(await verifySecretAsync(oldKey, verifier!)).toBe(false);
    expect(await verifySecretAsync(oldKey, oldVerifier!)).toBe(true);
    expect(await verifySecretAsync(key!, oldVerifier!)).toBe(false);
    expect(
      (await suite.db.select().from(invoiceSeries)).map((s) => ({
        code: s.code,
        nextNumber: s.nextNumber,
      })),
    ).toEqual([
      { code: "A-06RB", nextNumber: 123 },
      { code: "FF-06RB", nextNumber: 123 },
      { code: "R-06RB", nextNumber: 123 },
    ]);
    expect(await readFile(historyPath)).toEqual(originalHistory);
    const log = await readFile(join(scratch, "logs/waitron.log"), "utf8");
    expect(log).not.toContain(key!);
    expect(log).not.toContain(oldKey);
    expect(log).not.toContain(token);
  } finally {
    await agent?.close();
    await server?.close();
    await rm(scratch, { recursive: true, force: true });
  }
});
