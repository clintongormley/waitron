import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { eq, sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { loadKeyRing, putCredential } from "@waitron/credentials";
import {
  invoiceSeries,
  locations,
  nodes,
  setNodePublicKey,
  stampDeployment,
  withTransaction,
} from "@waitron/db";
import { readRecoveryKeyVerifier } from "@waitron/node-db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { verifySecretAsync } from "@waitron/identity";
import { openManagementSession } from "@waitron/identity/test/fixtures.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { readRecoveryPackPdf } from "@waitron/recovery-pack";
import { locationId } from "@waitron/shared";
import { parseRecoveryKit } from "@waitron/stream";
import { seedTenants, TENANT_A, TENANT_B } from "@waitron/fiscal-verifactu/test/fixtures.js";
import { seedFixtureSif } from "@waitron/fiscal-verifactu/test/sif-fixture.js";
import { decodeArchiveRecoveryPack } from "./archive-recovery-pack.js";
import { writeArchiveSettings } from "./archive-settings.js";
import { writeRecoveryKey } from "./backup-env-writer.js";
import type { StartedServer } from "./boot.js";
import type { Turns } from "./backup-turns.js";
import { ensureBoxSecrets } from "./box-secrets.js";
import { mintBreakGlassSecret } from "./break-glass.js";
import { STREAM_PURPOSE, streamSettingsPayload } from "./stream-host.js";
import { awaitListening, copyMigrationsRoot, httpsVia } from "./testing/boot-harness.js";
import { ephemeralServerFixture } from "./testing/ephemeral-server-fixture.js";
import { freePorts } from "./testing/free-ports.js";

vi.mock("@hono/node-server", async () => {
  const { ephemeralHttpMock } = await import("./testing/ephemeral-listener.js");
  return ephemeralHttpMock();
});

/** Which turn queue, by the order the start created it, each turn was handed to. */
const turnsUsed = vi.hoisted(() => ({ created: 0, handed: [] as number[] }));
vi.mock("./backup-turns.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./backup-turns.js")>();
  return {
    ...actual,
    createTurns: (): Turns => {
      const queue = (turnsUsed.created += 1);
      const turns = actual.createTurns();
      return (body) => {
        turnsUsed.handed.push(queue);
        return turns(body);
      };
    },
  };
});

const { startServer, httpPort } = ephemeralServerFixture();

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
const node = { nodeId: TENANT_A.nodeId, locationId: locationId(TENANT_A.locationId) };
const KEY_ENV = {
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 5).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
};
const KEY = "recovery-key-at-the-real-start";
// A port nothing listens on, so a backup the start may try fails at once and never leaves the host.
const BUCKET = {
  endpoint: "https://127.0.0.1:1",
  region: "eu-south-2",
  bucket: "venue-copies",
  prefix: "shop/",
  accessKeyId: "AKIAEXAMPLE",
  secretAccessKey: "secret-example-at-the-real-start",
};

async function seedVenue(): Promise<void> {
  await seedTenants(suite.db);
  await suite.db.delete(nodes).where(eq(nodes.id, TENANT_B.nodeId));
  await suite.db.delete(locations).where(eq(locations.id, TENANT_B.locationId));
  await suite.db.update(nodes).set({ filingModule: "verifactu" }).where(eq(nodes.id, node.nodeId));
  await stampDeployment(suite.db, "preproduction");
  await seedFixtureSif(suite.db, {
    nodeId: node.nodeId,
    nif: "89890001K",
    idSistemaInformatico: "W1",
    numeroInstalacion: "0CNNW",
  });
  await suite.db.insert(invoiceSeries).values(
    [
      { code: "A-0CNNW", purpose: "standard" as const },
      { code: "R-0CNNW", purpose: "rectificative" as const },
      { code: "FF-0CNNW", purpose: "full" as const },
    ].map((series) => ({ ...series, nodeId: node.nodeId })),
  );
  await setNodePublicKey(suite.db, node.nodeId, "SIGNER_PUBLIC_KEY");
  await mintBreakGlassSecret({ venue: suite.db, node: suite.node }, node.nodeId);
  const ring = loadKeyRing(KEY_ENV);
  await withTransaction(suite.db, async (tx) => {
    await putCredential(tx, ring, {
      purpose: STREAM_PURPOSE,
      value: streamSettingsPayload({ venueId: node.locationId, bucket: BUCKET }),
    });
    await writeArchiveSettings(tx, ring, {
      enabled: true,
      destinations: [
        {
          kind: "s3",
          id: "bucket",
          bucket: { ...BUCKET, prefix: "archives/" },
          venueId: node.locationId,
        },
      ],
      schedule: { kind: "wall-clock", days: "daily", at: { hour: 3, minute: 30 } },
      retention: { count: 7, days: 30 },
      destinationTimeoutMs: 15 * 60 * 1000,
    });
  });
}

it("makes a pack over the real TLS listener, drawn with the production font, that the readers accept, and the status follows a key rotation", async () => {
  await seedVenue();
  const { token } = await openManagementSession(suite.db, "admin");
  const cookie = `waitron_management_session=${token}`;

  const scratch = await mkdtemp(join(tmpdir(), "a1187-boot-pack-"));
  let server: StartedServer | undefined;
  try {
    await copyMigrationsRoot(join(scratch, "migrations"));
    await writeFile(
      join(scratch, "modules.json"),
      JSON.stringify({ modules: { "fiscal-none": false } }),
    );
    await writeRecoveryKey(scratch, {
      recoveryKey: KEY,
      keyRotatedAt: "2026-09-20T08:00:00.000Z",
    });
    await ensureBoxSecrets({ stateDir: scratch, hostnames: ["localhost"], now: () => new Date() });
    const database = suite.db.all<{ file: string }>(sql`pragma database_list`)[0]!.file;
    const [port] = await freePorts(1);
    server = await startServer({
      ...KEY_ENV,
      WAITRON_VENUE_DIR: dirname(database),
      WAITRON_STATE_DIR: scratch,
      WAITRON_LOG_DIR: join(scratch, "logs"),
      WAITRON_MIGRATIONS_DIR: join(scratch, "migrations"),
      WAITRON_HTTP_PORT: String(port),
      WAITRON_HTTP_LANDING_PORT: "0",
      WAITRON_NODE_ID: node.nodeId,
      WAITRON_ENV: "dev",
    });
    await awaitListening(httpPort());
    const { via, close } = httpsVia(await readFile(join(scratch, "tls", "ca.crt")));
    const at = (path: string) => `https://127.0.0.1:${httpPort()}${path}`;
    const json = { cookie, "content-type": "application/json" };
    try {
      const beforeMake = turnsUsed.handed.length;
      const made = await fetch(at("/api/backup/recovery-pack"), {
        ...via,
        method: "POST",
        headers: json,
        body: JSON.stringify({
          locale: "es",
          newServerKey: false,
          signIn: { method: "password", password: "correct horse" },
        }),
      });
      expect(made.status).toBe(200);
      const makeQueue = turnsUsed.handed.slice(beforeMake);
      expect(made.headers.get("x-waitron-recovery-pack-key")).toBe("unchanged");
      const file = await readRecoveryPackPdf(new Uint8Array(await made.arrayBuffer()));
      expect(parseRecoveryKit(file.bucketCode!)).toMatchObject({
        venueId: node.locationId,
        recoveryKey: KEY,
        pointerSignerPublicKey: "SIGNER_PUBLIC_KEY",
      });
      expect(decodeArchiveRecoveryPack(file.archiveCode!)).toMatchObject({ recoveryKey: KEY });

      const received = await fetch(at(`/api/backup/recovery-pack/${file.number}/received`), {
        ...via,
        method: "POST",
        headers: json,
        body: "{}",
      });
      expect(received.status).toBe(204);
      const status = async () => {
        const response = await fetch(at("/api/backup/recovery-pack"), {
          ...via,
          headers: { cookie },
        });
        expect(response.status).toBe(200);
        return (await response.json()) as {
          upToDate: boolean;
          latest: { parts: { part: string; state: string }[] };
          reasons: { part: string; kind: string }[];
        };
      };
      const fresh = await status();
      // Every part drawn, the server key by the real fiscal module.
      expect(fresh.latest.parts).toEqual([
        { part: "bucket", state: "included" },
        { part: "archives", state: "included" },
        { part: "server-key", state: "included" },
      ]);
      expect(fresh.upToDate).toBe(true);

      const beforeRotate = turnsUsed.handed.length;
      const rotated = await fetch(at("/api/backup/rotate"), {
        ...via,
        method: "POST",
        headers: json,
        body: JSON.stringify({ recoveryKey: "a-new-recovery-key-after-the-pack" }),
      });
      expect(rotated.status).toBe(200);
      // The make waited in the same queue as the backup API's key change.
      expect(makeQueue).toHaveLength(1);
      expect(turnsUsed.handed.slice(beforeRotate)).toEqual(makeQueue);
      const stale = await status();
      expect(stale.upToDate).toBe(false);
      expect(stale.reasons).toContainEqual(
        expect.objectContaining({ part: "bucket", kind: "key_changed" }),
      );
      const log = await readFile(join(scratch, "logs", "waitron.log"), "utf8");
      expect(log).toContain('"event":"recovery.pack_made"');
      for (const secret of [KEY, BUCKET.secretAccessKey, file.bucketCode!, file.archiveCode!])
        expect(log).not.toContain(secret);
    } finally {
      await close();
    }
  } finally {
    await server?.close();
    await rm(scratch, { recursive: true, force: true });
  }
}, 60_000);

it("with the box ticked, the real fiscal module draws a new server key that the pack carries, changing no series counter and no evidence file, and logging neither key nor the session", async () => {
  await seedVenue();
  await suite.db.update(invoiceSeries).set({ nextNumber: 123 });
  const oldKey = await mintBreakGlassSecret({ venue: suite.db, node: suite.node }, node.nodeId);
  const { token } = await openManagementSession(suite.db, "admin");
  const cookie = `waitron_management_session=${token}`;

  const scratch = await mkdtemp(join(tmpdir(), "a1187-boot-pack-key-"));
  let server: StartedServer | undefined;
  try {
    await copyMigrationsRoot(join(scratch, "migrations"));
    await writeFile(
      join(scratch, "modules.json"),
      JSON.stringify({ modules: { "fiscal-none": false } }),
    );
    await writeRecoveryKey(scratch, {
      recoveryKey: KEY,
      keyRotatedAt: "2026-09-20T08:00:00.000Z",
    });
    await ensureBoxSecrets({ stateDir: scratch, hostnames: ["localhost"], now: () => new Date() });
    await mkdir(join(scratch, "module-evidence/fiscal-verifactu"), { recursive: true });
    const historyPath = join(scratch, "module-evidence/fiscal-verifactu/hour-history.json");
    await writeFile(
      historyPath,
      JSON.stringify({
        reference: "prepared-hours",
        complete: true,
        records: [
          {
            reference: "restored-sheet/0CNPG",
            kind: "backup",
            taxpayerNif: "89890001K",
            environment: "preproduction",
            softwareId: "W2",
            nodeId: "retired-node",
            identity: "0CNPG",
            recordedAtMs: null,
          },
        ],
      }),
    );
    const originalHistory = await readFile(historyPath);
    const database = suite.db.all<{ file: string }>(sql`pragma database_list`)[0]!.file;
    const [port] = await freePorts(1);
    server = await startServer({
      ...KEY_ENV,
      WAITRON_VENUE_DIR: dirname(database),
      WAITRON_STATE_DIR: scratch,
      WAITRON_LOG_DIR: join(scratch, "logs"),
      WAITRON_MIGRATIONS_DIR: join(scratch, "migrations"),
      WAITRON_HTTP_PORT: String(port),
      WAITRON_HTTP_LANDING_PORT: "0",
      WAITRON_NODE_ID: node.nodeId,
      WAITRON_ENV: "dev",
    });
    await awaitListening(httpPort());
    const { via, close } = httpsVia(await readFile(join(scratch, "tls", "ca.crt")));
    let carried: string;
    try {
      const made = await fetch(`https://127.0.0.1:${httpPort()}/api/backup/recovery-pack`, {
        ...via,
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          locale: "es",
          newServerKey: true,
          signIn: { method: "password", password: "correct horse" },
        }),
      });
      expect(made.status).toBe(200);
      expect(made.headers.get("x-waitron-recovery-pack-key")).toBe("replaced");
      const file = await readRecoveryPackPdf(new Uint8Array(await made.arrayBuffer()));
      const nodeKey = (file.serverKey as { nodeKey: { nodeId: string; secret: string } }).nodeKey;
      expect(nodeKey.nodeId).toBe(node.nodeId);
      carried = nodeKey.secret;
    } finally {
      await close();
    }
    await server.close();
    server = undefined;
    const verifier = (await readRecoveryKeyVerifier(suite.node, node.nodeId))!;
    expect(await verifySecretAsync(carried, verifier)).toBe(true);
    expect(await verifySecretAsync(oldKey, verifier)).toBe(false);
    expect(
      (await suite.db.select().from(invoiceSeries).orderBy(invoiceSeries.code)).map((s) => ({
        code: s.code,
        nextNumber: s.nextNumber,
      })),
    ).toEqual([
      { code: "A-0CNNW", nextNumber: 123 },
      { code: "FF-0CNNW", nextNumber: 123 },
      { code: "R-0CNNW", nextNumber: 123 },
    ]);
    expect(await readFile(historyPath)).toEqual(originalHistory);
    const log = await readFile(join(scratch, "logs", "waitron.log"), "utf8");
    expect(log).toContain('"event":"recovery.pack_made"');
    for (const secret of [carried, oldKey, token]) expect(log).not.toContain(secret);
  } finally {
    await server?.close();
    await rm(scratch, { recursive: true, force: true });
  }
}, 60_000);
