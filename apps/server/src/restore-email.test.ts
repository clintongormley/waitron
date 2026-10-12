import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { Hono } from "hono";
import { hashPin, persons, startManagementSession } from "@waitron/identity";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadKeyRing, putCredential, deleteCredential } from "@waitron/credentials";
import {
  invoiceSeries,
  locations,
  nodes,
  openVenueDatabase,
  tenants,
  withTransaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { generateNodeKeyPair } from "@waitron/membership";
import { encodeRecoveryKit, signPointer, writePointer, type RecoveryKit } from "@waitron/stream";
import { createMemoryObjectStore } from "@waitron/stream/testing/memory-store.js";
import { ALL_MODULES } from "./modules.js";
import { formatEnvFile, parseEnvFile } from "./env-file.js";
import { RECOVERY_FILES } from "./state-secrets.js";
import { runOnce } from "./backup-sweep.js";
import { LocalFsBackend } from "./local-fs-backend.js";
import { createCloudSnapshotArchive } from "./cloud-snapshot-archive.js";
import { createSealedStateRefresher } from "./sealed-state.js";
import { runRestore } from "./restore-command.js";
import { restoreFromArtifactFile } from "./restore.js";
import { restoreFromStream } from "./restore-stream.js";
import { runStagedRestore, stageRestoreRequest, stageStreamRestore } from "./restore-request.js";
import { mountEmailSettingsApi } from "./email-settings-api.js";
import { resolveInvoiceEmailDelivery } from "./email-delivery.js";

const T = {
  locationId: "c0000000-0000-4000-8000-000000000002",
  nodeId: "c0000000-0000-4000-8000-000000000008",
  seriesId: "c0000000-0000-4000-8000-000000000004",
};
const NOW = new Date("2026-10-08T12:00:00Z");
const RECOVERY_KEY = "synthetic-email-restore-key";
const KEY = Buffer.alloc(32, 17).toString("base64");
const FOREIGN_KEY = Buffer.alloc(32, 29).toString("base64");
const ring = loadKeyRing({ WAITRON_CREDENTIALS_KEY: KEY });
const SMTP = {
  url: "smtps://invoice-user:synthetic-password@smtp.example.test:465",
  from: "invoices@example.test",
};
const identity = formatEnvFile({
  WAITRON_TILL_NODE_ID: T.nodeId,
  WAITRON_TILL_LOCATION_ID: T.locationId,
  WAITRON_TILL_SERIES_ID: T.seriesId,
  WAITRON_ENV: "production",
});
const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  resetPerTest: false,
  timeoutMs: 120_000,
  setup: async (db) => {
    await db
      .insert(tenants)
      .values({ id: 1, country: "ES", taxId: "89890001K", legalName: "Restore venue" });
    await db.insert(locations).values({
      id: T.locationId,
      name: "Restaurant",
      invoiceLocales: ["es"],
      operationDescription: "Venta",
    });
    await db
      .insert(nodes)
      .values({ id: T.nodeId, locationId: T.locationId, name: "Original node" });
    await db.insert(invoiceSeries).values({ id: T.seriesId, nodeId: T.nodeId, code: "FA" });
    await db.insert(invoiceSeries).values({ nodeId: T.nodeId, code: "FF", purpose: "full" });
  },
});
const fixtureDirs: string[] = [];
const fixtures = new Map<boolean, { archive: Uint8Array; cloud: Uint8Array; database: string }>();
beforeAll(async () => {
  const root = await mkdtemp(join(tmpdir(), "waitron-email-restore-fixture-"));
  fixtureDirs.push(root);
  for (const path of RECOVERY_FILES) {
    const contents =
      path === "secrets.env"
        ? formatEnvFile({ WAITRON_CREDENTIALS_KEY: KEY })
        : path === "trading.env"
          ? identity
          : `synthetic ${path}`;
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), contents);
  }
  for (const configured of [false, true]) {
    await withTransaction(suite.db, async (tx) => {
      if (configured) await putCredential(tx, ring, { purpose: "email.smtp", value: SMTP });
      else await deleteCredential(tx, { purpose: "email.smtp" });
    });
    const status = { failedSince: null };
    expect(
      await createSealedStateRefresher({
        db: suite.db,
        nodeId: T.nodeId,
        stateDir: root,
        modules: ALL_MODULES,
        resolvers: {},
        environment: "production",
        readRecoveryKey: async () => RECOVERY_KEY,
        now: () => NOW,
        log: () => {},
        status,
      }).refresh(),
    ).toBe("sealed");
    const database = join(root, `stream-${String(configured)}.db`);
    await suite.db.archiveTo(database);
    const backend = new LocalFsBackend("receipt", join(root, `archives-${String(configured)}`));
    await runOnce({
      backends: [backend],
      db: suite.db,
      modules: ALL_MODULES,
      environment: "production",
      resolvers: {},
      stateDir: root,
      recoveryKey: RECOVERY_KEY,
      stagingDir: join(root, "staging"),
      retain: 1,
      retainDays: 1,
      signal: new AbortController().signal,
      log: () => {},
      archive: (path) => suite.db.archiveTo(path),
      now: () => NOW,
    });
    const archives = await backend.list("waitron-");
    expect(archives).toHaveLength(1);
    await writeFile(
      join(root, "trading.env"),
      formatEnvFile({ ...parseEnvFile(identity), WAITRON_ENV: "preproduction" }),
    );
    const cloud = await createCloudSnapshotArchive(
      {
        db: suite.db,
        modules: ALL_MODULES,
        environment: "preproduction",
        stateDir: root,
      },
      RECOVERY_KEY,
      NOW,
      new AbortController().signal,
    );
    await writeFile(join(root, "trading.env"), identity);
    fixtures.set(configured, {
      archive: await backend.get(archives[0]!.key),
      cloud: cloud.bytes,
      database,
    });
  }
});
afterAll(async () => {
  for (const path of fixtureDirs) await rm(path, { recursive: true, force: true });
});

const paths = [
  "command archive",
  "wizard archive",
  "command bucket",
  "wizard bucket",
  "managed Cloud staging",
] as const;
describe.each(paths)("invoice email after %s", (path) => {
  it.each([
    { destination: "existing original identity", configured: true },
    { destination: "replacement with foreign vault key", configured: true },
    { destination: "existing original identity", configured: false },
    { destination: "replacement with foreign vault key", configured: false },
  ])("$destination, SMTP configured=$configured", async ({ destination, configured }) => {
    const root = await mkdtemp(join(tmpdir(), "waitron-email-restore-target-"));
    try {
      const stateDir = join(root, "state");
      const venueDir = join(root, "venue");
      await mkdir(stateDir);
      await writeFile(
        join(stateDir, "secrets.env"),
        formatEnvFile({
          WAITRON_CREDENTIALS_KEY: destination === "existing original identity" ? KEY : FOREIGN_KEY,
        }),
      );
      if (destination === "existing original identity")
        await writeFile(join(stateDir, "trading.env"), identity);
      const fixture = fixtures.get(configured)!;
      const environment = path === "managed Cloud staging" ? "preproduction" : "production";
      const common = {
        stateDir,
        venueDir,
        stagingDir: join(root, "staging"),
        modules: ALL_MODULES,
        migrationsRoot: null,
        environment,
        log: () => {},
      } as const;
      const lines: unknown[] = [];
      const log = (...line: unknown[]) => {
        lines.push(line);
      };
      if (path.includes("bucket")) {
        const signer = generateNodeKeyPair();
        const store = createMemoryObjectStore({ now: () => NOW });
        const kit: RecoveryKit = {
          version: 1,
          venueId: T.locationId,
          bucket: {
            region: "eu-west-1",
            bucket: "synthetic",
            prefix: "",
            accessKeyId: "synthetic-access",
            secretAccessKey: "synthetic-secret",
          },
          recoveryKey: RECOVERY_KEY,
          pointerSignerPublicKey: signer.publicKey,
        };
        await writePointer(
          store,
          T.locationId,
          signPointer(
            {
              venueId: T.locationId,
              term: 0,
              nodeId: T.nodeId,
              generation: `gen-0-${T.nodeId}-20261008T120000Z`,
              writtenAt: NOW.toISOString(),
            },
            signer.privateKey,
          ),
          null,
        );
        const preparation = {
          ...common,
          kit,
          litestreamBin: "/unused",
          oldBoxGone: true,
          now: () => NOW,
          openStore: () => store,
          log,
          restoreGeneration: async (args: { outPath: string }) => {
            await copyFile(fixture.database, args.outPath);
          },
        };
        if (path === "command bucket") {
          const kitPath = join(root, "kit.json");
          await writeFile(kitPath, encodeRecoveryKit(kit));
          expect(
            await runRestore({
              argv: [
                "restore",
                "--from-bucket",
                kitPath,
                "--confirm-venue",
                "89890001K",
                "--confirm-old-box-gone",
              ],
              env: {
                WAITRON_STATE_DIR: stateDir,
                WAITRON_VENUE_DIR: venueDir,
                WAITRON_ENV: environment,
              },
              out: (line) => {
                lines.push(line);
              },
              openStore: () => store,
              restoreStream: (args) =>
                restoreFromStream({
                  ...args,
                  migrationsRoot: null,
                  restoreGeneration: preparation.restoreGeneration,
                }),
            }),
          ).toBe(0);
        } else {
          await stageStreamRestore({ ...preparation, venueConfirmed: "89890001K" });
          expect(await runStagedRestore({ ...common, log })).toBe(true);
        }
      } else if (path === "command archive") {
        const artifactPath = join(root, "archive.wtb");
        await writeFile(artifactPath, fixture.archive);
        expect(
          await runRestore({
            argv: ["restore", artifactPath, "--confirm-old-box-gone"],
            env: {
              WAITRON_STATE_DIR: stateDir,
              WAITRON_VENUE_DIR: venueDir,
              WAITRON_ENV: environment,
              WAITRON_BACKUP_RECOVERY_KEY: RECOVERY_KEY,
            },
            out: (line) => {
              lines.push(line);
            },
            restore: (args) => restoreFromArtifactFile({ ...args, migrationsRoot: null }),
          }),
        ).toBe(0);
      } else {
        await stageRestoreRequest(stateDir, {
          artifact: path === "managed Cloud staging" ? fixture.cloud : fixture.archive,
          recoveryKey: RECOVERY_KEY,
          environment,
          ...(path === "managed Cloud staging"
            ? {
                managedCloud: {
                  requestId: "c0000000-0000-4000-8000-000000000020",
                  pointId: "c0000000-0000-4000-8000-000000000021",
                },
              }
            : {}),
        });
        expect(await runStagedRestore({ ...common, log })).toBe(true);
      }
      const restoredRing = loadKeyRing(
        parseEnvFile(await readFile(join(stateDir, "secrets.env"), "utf8")),
      );
      expect(restoredRing.current.key.equals(Buffer.from(KEY, "base64"))).toBe(true);
      const restoredIdentity = parseEnvFile(await readFile(join(stateDir, "trading.env"), "utf8"));
      expect(restoredIdentity.WAITRON_TILL_NODE_ID).toBe(T.nodeId);
      const opened = await openVenueDatabase(venueDir);
      try {
        expect(
          await resolveInvoiceEmailDelivery(opened.venue, restoredRing, {
            onboardingIntent: "live",
            devMode: false,
          }),
        ).toEqual(configured ? { mode: "smtp", smtp: SMTP } : { mode: "unconfigured" });
        const session = await withTransaction(opened.venue, async (tx) => {
          const [person] = await tx
            .insert(persons)
            .values({
              displayName: "Restore manager",
              pinHash: hashPin("1234"),
              role: "manager",
              email: "owner@example.test",
            })
            .returning({ id: persons.id });
          return startManagementSession(tx, { personId: person!.id });
        });
        const app = new Hono();
        mountEmailSettingsApi(
          app,
          {
            db: opened.venue,
            ring: restoredRing,
            config: { onboardingIntent: "live", devMode: false },
          },
          log,
        );
        const response = await app.request("/management-api/email/settings", {
          headers: { cookie: `${MANAGEMENT_COOKIE}=${session.token}` },
        });
        expect(response.status).toBe(200);
        const view = await response.json();
        expect(view).toEqual(
          configured
            ? {
                mode: "smtp",
                editable: true,
                settings: {
                  server: "smtp.example.test",
                  port: 465,
                  encryption: "tls",
                  from: "invoices@example.test",
                  hasAuthentication: true,
                },
              }
            : { mode: "unconfigured", editable: true, settings: null },
        );
        expect(JSON.stringify(view)).not.toContain("synthetic-password");
        expect(JSON.stringify(view)).not.toContain("invoice-user");
        if (!configured) {
          const saved = await app.request("/management-api/email/settings", {
            method: "PUT",
            headers: {
              cookie: `${MANAGEMENT_COOKIE}=${session.token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              server: "smtp.example.test",
              port: 465,
              encryption: "tls",
              from: SMTP.from,
              user: "invoice-user",
              password: "synthetic-password",
            }),
          });
          expect(saved.status).toBe(200);
          expect(await saved.json()).toEqual({ saved: true });
          expect(
            await resolveInvoiceEmailDelivery(opened.venue, restoredRing, {
              onboardingIntent: "live",
              devMode: false,
            }),
          ).toEqual({ mode: "smtp", smtp: SMTP });
        }
      } finally {
        await opened.close();
      }
      const serialized = JSON.stringify(lines);
      for (const secret of [KEY, FOREIGN_KEY, SMTP.url, "synthetic-password", SMTP.from])
        expect(serialized).not.toContain(secret);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
