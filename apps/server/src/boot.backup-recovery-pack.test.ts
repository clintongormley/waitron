import { seriesWithNextNumber, advanceSeriesTo } from "@waitron/db/testing/seed.js";
import { seedModuleSettings } from "../test/module-settings.js";
import { readStreamId } from "@waitron/db";
import { ensureStreamId } from "@waitron/db";
import { setFreshManagementSignIn } from "./testing/fresh-management-sign-in.js";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { eq, sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { loadKeyRing } from "@waitron/credentials";
import {
  invoiceSeries,
  nodes,
  setNodePublicKey,
  stampDeployment,
  withTransaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { openManagementSession } from "@waitron/identity/test/fixtures.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { readRecoveryPackPdf } from "@waitron/recovery-pack/src/read-pack-pdf.js";
import { parseRecoveryKit } from "@waitron/stream";
import { seedTaxpayers, TAXPAYER_A, TAXPAYER_B } from "@waitron/fiscal-verifactu/test/fixtures.js";
import { seedFixtureSif } from "@waitron/fiscal-verifactu/test/sif-fixture.js";
import { decodeArchiveRecoveryPack } from "./archive-recovery-pack.js";
import { writeArchiveSettings } from "./archive-settings.js";
import { writeBackupKey } from "./backup-env-writer.js";
import { HELD_BACKUP_KEY } from "./testing/recovery-key.js";
import { mintMasterKey } from "./testing/master-key.js";
import type { StartedServer } from "./boot.js";
import type { Turns } from "./backup-turns.js";
import { ensureBoxSecrets } from "./box-secrets.js";
import { writeStreamSettings } from "./stream-host.js";
import { awaitListening, copyMigrationsRoot, httpsVia } from "./testing/boot-harness.js";
import { ephemeralServerFixture } from "./testing/ephemeral-server-fixture.js";
import { freePorts } from "./testing/free-ports.js";

vi.mock("@hono/node-server", async () => {
  const { ephemeralHttpMock } = await import("./testing/ephemeral-listener.js");
  return ephemeralHttpMock();
});

/**
 * Which turn queue, by the order the start created it, each turn was handed to. The spare follow's
 * own queue is left out: its pass takes a turn every few seconds, whatever the requests do.
 */
const turnsUsed = vi.hoisted(() => ({
  created: 0,
  handed: [] as number[],
  inSpareFollow: false,
}));
vi.mock("./backup-turns.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./backup-turns.js")>();
  return {
    ...actual,
    createTurns: (): Turns => {
      const turns = actual.createTurns();
      if (turnsUsed.inSpareFollow) return turns;
      const queue = (turnsUsed.created += 1);
      return (body) => {
        turnsUsed.handed.push(queue);
        return turns(body);
      };
    },
  };
});
vi.mock("./spare-follow.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./spare-follow.js")>();
  return {
    ...actual,
    startSpareFollow: (...args: Parameters<typeof actual.startSpareFollow>) => {
      turnsUsed.inSpareFollow = true;
      try {
        return actual.startSpareFollow(...args);
      } finally {
        turnsUsed.inSpareFollow = false;
      }
    },
  };
});

const { startServer, httpPort } = ephemeralServerFixture();

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
const node = { nodeId: TAXPAYER_A.nodeId };
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

async function seedVenueWithBackupSettings(): Promise<void> {
  await seedTaxpayers(suite.db);
  await suite.db.delete(nodes).where(eq(nodes.id, TAXPAYER_B.nodeId));
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
      { code: "R-0CNNW", purpose: "corrective" as const },
      { code: "FF-0CNNW", purpose: "full" as const },
    ].map((series) => ({ ...series, nodeId: node.nodeId })),
  );
  await setNodePublicKey(suite.db, node.nodeId, "SIGNER_PUBLIC_KEY");
  const ring = loadKeyRing(KEY_ENV);
  await withTransaction(suite.db, async (tx) => {
    await ensureStreamId(tx);
    await writeStreamSettings(tx, ring, BUCKET, null);
    await writeArchiveSettings(
      tx,
      ring,
      {
        enabled: true,
        destinations: [
          {
            kind: "s3",
            id: "bucket",
            bucket: { ...BUCKET, prefix: "archives/" },
          },
        ],
        schedule: { kind: "wall-clock", days: "daily", at: { hour: 3, minute: 30 } },
        retention: { count: 7, days: 30 },
        destinationTimeoutMs: 15 * 60 * 1000,
      },
      null,
    );
  });
}

it("makes a pack over the real TLS listener, drawn with the production font, that the readers accept, and the status follows a key rotation", async () => {
  await seedVenueWithBackupSettings();
  const master = await mintMasterKey(suite.db);
  const { token } = await openManagementSession(suite.db, "admin");
  await withTransaction(suite.db, (tx) => setFreshManagementSignIn(tx, token));
  const cookie = `waitron_management_session=${token}`;

  const scratch = await mkdtemp(join(tmpdir(), "a1187-boot-pack-"));
  let server: StartedServer | undefined;
  try {
    await copyMigrationsRoot(join(scratch, "migrations"));
    await seedModuleSettings(suite.db, { "fiscal-none": false });
    await writeBackupKey(scratch, {
      ...HELD_BACKUP_KEY,
      key: KEY,
      rotatedAt: "2026-09-20T08:00:00.000Z",
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
          masterKey: master.secret,
        }),
      });
      expect(made.status).toBe(200);
      const makeQueue = turnsUsed.handed.slice(beforeMake);
      expect(made.headers.has("x-waitron-recovery-pack-key")).toBe(false);
      const file = await readRecoveryPackPdf(new Uint8Array(await made.arrayBuffer()));
      expect(parseRecoveryKit(file.bucketCode!)).toMatchObject({
        streamId: await readStreamId(suite.db),
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
      expect(fresh.latest.parts).toEqual([
        { part: "emergency", state: "absent" },
        { part: "bucket", state: "included" },
        { part: "archives", state: "included" },
        { part: "master-key", state: "included" },
      ]);
      expect(fresh.upToDate).toBe(true);

      const beforeRotate = turnsUsed.handed.length;
      const rotated = await fetch(at("/api/backup/rotate"), {
        ...via,
        method: "POST",
        headers: json,
        body: JSON.stringify({ masterKey: master.secret }),
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

it("Make a new master key over the real listener changes no series counter and no evidence file, and logs neither the master key nor the session", async () => {
  await seedVenueWithBackupSettings();
  await advanceSeriesTo(suite.db, node.nodeId, 123);
  const { token } = await openManagementSession(suite.db, "admin");
  await withTransaction(suite.db, (tx) => setFreshManagementSignIn(tx, token));
  const cookie = `waitron_management_session=${token}`;

  const scratch = await mkdtemp(join(tmpdir(), "a1187-boot-pack-key-"));
  let server: StartedServer | undefined;
  try {
    await copyMigrationsRoot(join(scratch, "migrations"));
    await seedModuleSettings(suite.db, { "fiscal-none": false });
    await writeBackupKey(scratch, {
      ...HELD_BACKUP_KEY,
      key: KEY,
      rotatedAt: "2026-09-20T08:00:00.000Z",
    });
    await ensureBoxSecrets({ stateDir: scratch, hostnames: ["localhost"], now: () => new Date() });
    await mkdir(join(scratch, "module-records"), { recursive: true });
    const historyPath = join(scratch, "module-records/fiscal-verifactu.json");
    await writeFile(
      historyPath,
      JSON.stringify({
        version: 1,
        prepared: [],
        retained: {
          "hour-history": {
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
          },
        },
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
    let masterKey: string;
    try {
      const made = await fetch(`https://127.0.0.1:${httpPort()}/api/backup/recovery-pack`, {
        ...via,
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          locale: "es",
          newMasterKey: true,
        }),
      });
      expect(made.status).toBe(200);
      const file = await readRecoveryPackPdf(new Uint8Array(await made.arrayBuffer()));
      masterKey = made.headers.get("x-waitron-master-key")!;
      expect(file.masterKey).toBe(masterKey);
    } finally {
      await close();
    }
    await server.close();
    server = undefined;
    expect(
      (
        await suite.db.select(seriesWithNextNumber).from(invoiceSeries).orderBy(invoiceSeries.code)
      ).map((s) => ({
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
    for (const secret of [masterKey.slice(0, 9), masterKey.replaceAll(" ", "").slice(0, 8), token])
      expect(log).not.toContain(secret);
  } finally {
    await server?.close();
    await rm(scratch, { recursive: true, force: true });
  }
}, 60_000);
