import { setFreshManagementSignIn } from "./testing/fresh-management-sign-in.js";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TLSSocket } from "node:tls";
import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { loadKeyRing } from "@waitron/credentials";
import { withTransaction, readRecoveryPacks } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { openManagementSession } from "@waitron/identity/test/fixtures.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { parseModuleConfig } from "@waitron/module";
import type { VenueRequest } from "@waitron/provisioning";
import type { NodeId } from "@waitron/shared";
import { readRecoveryPackPdf } from "@waitron/recovery-pack";
import { mountBackupRecoveryPackMakeApi } from "./backup-recovery-pack-api.js";
import { createTurns } from "./backup-turns.js";
import { mintBreakGlassKey } from "./break-glass.js";
import { invoiceFontBytes } from "./invoice-font.js";
import { ALL_MODULES } from "./modules.js";
import { provisionVenue, venueModuleConfig } from "./provision.js";
import { readRecoveryDocumentEvidence } from "./recovery-document-evidence.js";

const RING = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 9).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});
const KEY = "recovery-key-recognisable-SECRET";

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
const ES_CONFIG = venueModuleConfig(parseModuleConfig({}, ALL_MODULES), "ES-common");

let root: string;
let roots: { stateDir: string; venueDir: string };
const sockets: TLSSocket[] = [];
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-16T11:40:00.000Z"));
  root = await mkdtemp(join(tmpdir(), "waitron-throwaway-pack-"));
  roots = { stateDir: join(root, "state"), venueDir: join(root, "venue") };
  await mkdir(roots.stateDir);
  await mkdir(roots.venueDir);
});
afterEach(async () => {
  vi.useRealTimers();
  for (const socket of sockets.splice(0)) socket.destroy();
  await rm(root, { recursive: true, force: true });
});

const venue: VenueRequest = {
  country: "ES",
  taxId: "B12345674",
  legalName: "Real Restaurant S.L.",
  name: "Casa Real",
  fiscalTerritory: "ES-common",
  invoiceLocales: ["es-ES"],
  operationDescription: "Venta en establecimiento",
  addressLine1: "Calle Mayor 1",
  addressLine2: null,
  postalCode: "28013",
  city: "Madrid",
  province: "Madrid",
  timeZone: "Europe/Madrid",
  dayCutover: "05:00",
  seriesCode: "A",
  fullSeriesCode: "FF",
  rectificativeSeriesCode: "R",
  admin: {
    displayName: "Admin",
    pinHash: "pin-hash",
    passwordHash: "password-hash",
    email: "admin@example.test",
  },
};

async function makePack(options: { beforeMaking?: () => Promise<void> } = {}) {
  const { nodeId } = await provisionVenue(
    { ownerDb: suite.db, moduleConfig: ES_CONFIG, database: "waitron", stateDir: roots.stateDir },
    {
      environment: "preproduction",
      venue,
      initialAllocation: { kind: "throwaway", hostEnvironment: "preproduction" },
    },
  );
  await mintBreakGlassKey({ venue: suite.db, node: suite.node }, nodeId);
  const admin = await openManagementSession(suite.db, "admin");
  await withTransaction(suite.db, (tx) => setFreshManagementSignIn(tx, admin.token));
  await options.beforeMaking?.();
  const app = new Hono();
  mountBackupRecoveryPackMakeApi(
    app,
    {
      db: suite.db,
      nodeDb: suite.node,
      ring: RING,
      node: { nodeId: nodeId as NodeId },
      modules: ALL_MODULES,
      turns: createTurns(),
      readBoxEnv: async () => ({
        WAITRON_BACKUP_RECOVERY_KEY: KEY,
        WAITRON_BACKUP_KEY_ROTATED_AT: "2026-09-20T08:00:00.000Z",
      }),
      backups: () => ({
        schedule: { kind: "wall-clock", days: "daily", at: { hour: 3, minute: 30 } },
        retention: { count: 7, days: 30 },
        recoveryKey: KEY,
      }),
      documentEvidence: (module) => readRecoveryDocumentEvidence(roots, module),
      loadFont: async () => invoiceFontBytes,
      now: () => new Date("2026-10-16T12:00:00.000Z"),
    },
    () => {},
  );
  const socket = new TLSSocket(new Socket());
  sockets.push(socket);
  const response = await app.request(
    "https://box.test/api/backup/recovery-pack",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie: `waitron_management_session=${admin.token}`,
      },
      body: JSON.stringify({
        locale: "en",
        newServerKey: true,
      }),
    },
    { incoming: { socket } },
  );
  const [record] = await readRecoveryPacks(suite.db, nodeId);
  return { response, record };
}

// A refused fiscal page does not refuse the pack: the route still answers 200 and marks only the
// server-key part failed. So the key header and that part are what tell the two apart.
it("makes the PDF recovery pack, fiscal page included, for a venue set up with a throwaway allocation", async () => {
  const { response, record } = await makePack();
  expect(
    suite.db.all(
      sql`select json_extract(allocation, '$.allocationId') like 'throwaway-%' as throwaway from fiscal_allocations`,
    ),
  ).toEqual([{ throwaway: 1 }]);
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("application/pdf");
  expect(response.headers.get("x-waitron-recovery-pack-key")).toBe("replaced");
  const file = await readRecoveryPackPdf(new Uint8Array(await response.arrayBuffer()));
  expect(file.number).toBe(1);
  expect(file.serverKey).toMatchObject({
    kind: "waitron-recovery-document",
    scope: { taxpayerNif: venue.taxId, environment: "preproduction" },
  });
  expect(record!.parts.find((p) => p.part === "server-key")).toMatchObject({
    state: "included",
    carriedKey: true,
  });
});

it("control: the same venue with unreadable fiscal evidence makes the pack with the fiscal page failed", async () => {
  const { response, record } = await makePack({
    beforeMaking: () =>
      writeFile(join(roots.stateDir, "module-preparation-state.json"), "{not valid JSON"),
  });
  expect(response.status).toBe(200);
  expect(response.headers.get("x-waitron-recovery-pack-key")).toBe("failed");
  expect(
    (await readRecoveryPackPdf(new Uint8Array(await response.arrayBuffer()))).serverKey,
  ).toBeNull();
  expect(record!.parts.find((p) => p.part === "server-key")).toMatchObject({
    state: "failed",
    carriedKey: false,
  });
});
