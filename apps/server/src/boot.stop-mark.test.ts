import { loadKeyRing } from "@waitron/credentials";
import {
  enqueueMail,
  incidents,
  outgoingMail,
  persons,
  withTransaction,
  writeNodeMembership,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { buildNextMembershipDocument } from "@waitron/membership";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { AppError } from "@waitron/shared";
import { pointerKey, signPointer } from "@waitron/stream";
import { SwitchableStore } from "@waitron/stream/testing/switchable-store.js";
import { eq } from "drizzle-orm";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import * as atomic from "./fs-atomic.js";
import { boxHostnameFor } from "./box-name.js";
import * as boxEmail from "./box-alert-email.js";
import { seedTermZeroMembership } from "./membership-seed.js";
import { establishNodeIdentity, readNodeIdentityKey } from "./node-identity.js";
import * as stopAlert from "./stop-alert.js";
import { readStreamSettings, writeStreamSettings } from "./stream-host.js";
import { startFakeSmtp } from "./testing/boot-harness.js";
import { TRADING_BOOT_KEY_ENV } from "./testing/boot-trading-fixture.js";
import { fakeMdnsSocket } from "./testing/fake-mdns-socket.js";
import {
  ephemeralServerFixture,
  withTradingBootServer,
} from "./testing/ephemeral-server-fixture.js";
import { setupVenue } from "./testing/venue-fixtures.js";
import { saveSmtpForTest } from "./testing/saved-smtp.js";
import { synchronisedBoxHost } from "./testing/synchronised-box-host.js";

vi.mock("@hono/node-server", async () => {
  const { ephemeralHttpMock } = await import("./testing/ephemeral-listener.js");
  return ephemeralHttpMock();
});

const { startServer, httpPort } = ephemeralServerFixture();
const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
const heartbeatAt = "2026-10-22T09:31:00.000Z";

async function configureStartupBucket() {
  const { cfg } = await setupVenue(suite.db);
  const ring = loadKeyRing(TRADING_BOOT_KEY_ENV);
  const identity = { ownerDb: suite.db, node: suite.node, ring };
  await establishNodeIdentity(identity, cfg.nodeId);
  await seedTermZeroMembership({ ...identity, db: suite.db }, cfg.nodeId, "https://old.example");
  await withTransaction(suite.db, (tx) =>
    writeStreamSettings(
      tx,
      ring,
      {
        region: "eu-west-1",
        bucket: "copies",
        prefix: "",
        accessKeyId: "test",
        secretAccessKey: "test-secret",
      },
      null,
    ),
  );
  const key = await readNodeIdentityKey(suite.node, ring, cfg.nodeId);
  const { streamId } = (await readStreamSettings(suite.db, ring))!;
  return { cfg, key, streamId, ring };
}

it("serves a non-trading bucket waiting page after an unexpected stop", async () => {
  const { cfg } = await configureStartupBucket();
  const bucket = new SwitchableStore(() => new Date());
  bucket.down = true;
  let started: Awaited<ReturnType<typeof startServer>>;
  await withTradingBootServer(
    {
      db: suite.db,
      nodeId: cfg.nodeId,
      scratchPrefix: "waitron-boot-bucket-wait-",
      start: async (env) => {
        started = await startServer(env, env, {
          previousStop: { restart: false, heartbeatAt: null },
          boxHost: synchronisedBoxHost(),
          stream: { store: bucket },
          waitingStart: { intervalMs: 100 },
        });
        return started;
      },
      httpPort,
    },
    async (base) => {
      const probe = await fetch(`${base}/api/node`);
      expect(await probe.json()).toMatchObject({ acceptingSales: false });
      const page = await fetch(base, { headers: { "Accept-Language": "en" } });
      expect(await page.text()).toContain("Waiting for the backup bucket");
      expect((await fetch(`${base}/carry-on`, { method: "POST" })).status).toBe(404);
      const sale = await fetch(`${base}/api/working-orders/order-1/payments`, { method: "POST" });
      expect(sale.status).toBe(404);
      await sale.text();

      bucket.down = false;
      await started.fullyStarted;
      await vi.waitFor(async () => {
        const trading = await fetch(`http://127.0.0.1:${httpPort()}/api/node`);
        expect(await trading.json()).toMatchObject({ acceptingSales: true });
      });
    },
  );
});

it("waits and emails managers when the bucket is silent and the chart's spare never joined", async () => {
  const { cfg, key, ring } = await configureStartupBucket();
  const chart = buildNextMembershipDocument({
    heldDocument: null,
    minTerm: 1,
    nodes: [
      { nodeId: cfg.nodeId, contactUrl: "https://old.example", standing: "serving-primary" },
      {
        nodeId: "00000000-0000-4000-8000-000000000034",
        contactUrl: "https://joining.example",
        standing: "serving-secondary",
      },
    ],
    signerNodeId: cfg.nodeId,
    signerPrivateKey: key,
    endorsements: [],
  });
  await writeNodeMembership(suite.db, chart);
  await stopAlert.recordUnconfirmedStart(suite.db, new Date(heartbeatAt));
  const bucket = new SwitchableStore(() => new Date());
  bucket.down = true;
  const smtp = await startFakeSmtp();
  const job = boxEmail.boxAlertMailJob;
  const schedule = vi.spyOn(boxEmail, "boxAlertMailJob").mockImplementationOnce((...args) => ({
    ...job(...args),
    firstPassAfterMs: 0,
  }));
  let started: Awaited<ReturnType<typeof startServer>>;
  try {
    await withTransaction(suite.db, (tx) =>
      saveSmtpForTest(tx, ring, {
        url: `smtp://127.0.0.1:${smtp.port}`,
        from: "notices@example.test",
      }),
    );
    await withTradingBootServer(
      {
        db: suite.db,
        nodeId: cfg.nodeId,
        scratchPrefix: "waitron-boot-bucket-timeout-",
        start: async (env) => {
          started = await startServer(env, env, {
            previousStop: { restart: false, heartbeatAt: null },
            boxHost: synchronisedBoxHost(),
            stream: { store: bucket },
            waitingStart: { intervalMs: 20, bucketWaitMs: 1_000 },
          });
          return started;
        },
        httpPort,
      },
      async (base) => {
        const probe = await fetch(`${base}/api/node`);
        expect(await probe.json()).toMatchObject({ acceptingSales: false });
        await started.fullyStarted;
        await vi.waitFor(async () => {
          const trading = await fetch(`http://127.0.0.1:${httpPort()}/api/node`);
          expect(await trading.json()).toMatchObject({ acceptingSales: true });
        });
        const rows = await suite.db
          .select({ handledAt: incidents.acknowledgedAt, severity: incidents.severity })
          .from(incidents)
          .where(eq(incidents.code, "start.selling_unconfirmed"));
        expect(rows).toEqual(
          expect.arrayContaining([
            { handledAt: expect.anything(), severity: "warning" },
            { handledAt: null, severity: "warning" },
          ]),
        );
        expect(rows).toHaveLength(2);
        await vi.waitFor(() => expect(smtp.messages).toHaveLength(1), { timeout: 8_000 });
        expect(smtp.messages[0]).toContain("To: owner@example.test");
        expect(smtp.messages[0]).toContain("Tras detenerse sin aviso");
        expect(smtp.messages[0]).toContain("tras esperar un minuto");
      },
    );
  } finally {
    schedule.mockRestore();
    await smtp.close();
  }
}, 15_000);

it("starts a planned restart while the configured bucket stays silent", async () => {
  const { cfg } = await configureStartupBucket();
  const bucket = new SwitchableStore(() => new Date());
  bucket.down = true;
  await withTradingBootServer(
    {
      db: suite.db,
      nodeId: cfg.nodeId,
      scratchPrefix: "waitron-boot-bucket-restart-",
      start: (env) =>
        startServer(env, env, {
          previousStop: { restart: true, heartbeatAt },
          boxHost: synchronisedBoxHost(),
          stream: { store: bucket },
        }),
      httpPort,
    },
    async (base) => {
      const probe = await fetch(`${base}/api/node`);
      expect(await probe.json()).toMatchObject({ acceptingSales: true });
      expect(
        await suite.db
          .select({ id: incidents.id })
          .from(incidents)
          .where(eq(incidents.code, "start.selling_unconfirmed")),
      ).toEqual([]);
    },
  );
});

it("keeps a verified replacement stopped while retrying its local marker", async () => {
  const { cfg, key, streamId } = await configureStartupBucket();
  const bucket = new SwitchableStore(() => new Date());
  const pointer = signPointer(
    {
      streamId,
      nodeId: cfg.nodeId,
      term: 1,
      generation: `gen-1-${cfg.nodeId}-20261022T093100Z`,
      writtenAt: heartbeatAt,
    },
    key,
  );
  await bucket.put(pointerKey(), new TextEncoder().encode(JSON.stringify(pointer)));
  const write = atomic.writeFileDurable;
  let markerFile: string | undefined;
  let rejectFirst = true;
  const saved = vi.spyOn(atomic, "writeFileDurable").mockImplementation(async (...args) => {
    if (args[0].endsWith("/replaced.json") && rejectFirst) {
      rejectFirst = false;
      bucket.down = true;
      throw Object.assign(new Error("disk full"), { code: "ENOSPC" });
    }
    return write(...args);
  });
  try {
    await withTradingBootServer(
      {
        db: suite.db,
        nodeId: cfg.nodeId,
        scratchPrefix: "waitron-boot-bucket-replacement-",
        start: (env) => {
          markerFile = join(env.WAITRON_STATE_DIR!, "replaced.json");
          return startServer(env, env, {
            previousStop: { restart: false, heartbeatAt },
            boxHost: synchronisedBoxHost(),
            stream: { store: bucket },
          });
        },
        httpPort,
      },
      async (base) => {
        const probe = await fetch(`${base}/api/node`);
        expect(await probe.json()).toMatchObject({ acceptingSales: false });
        const page = await fetch(base, { headers: { "Accept-Language": "en" } });
        expect(await page.text()).toContain("Leave this box switched off");
        expect(rejectFirst).toBe(false);
        await vi.waitFor(async () => {
          expect(JSON.parse(await readFile(markerFile!, "utf8"))).toMatchObject({
            streamId,
            term: 1,
          });
        });
      },
    );
  } finally {
    saved.mockRestore();
  }
});

it.each([
  { restart: false, heartbeatAt },
  { restart: true, heartbeatAt },
  { restart: false, heartbeatAt: null },
])("records only the unexpected primary stop (%j)", async (previousStop) => {
  const venue = await setupVenue(suite.db);
  await withTradingBootServer(
    {
      db: suite.db,
      nodeId: venue.cfg.nodeId,
      scratchPrefix: "waitron-boot-stop-",
      start: (env) => startServer(env, env, { previousStop, boxHost: synchronisedBoxHost() }),
      httpPort,
    },
    async () => {
      const rows = await suite.db
        .select({ params: incidents.params, severity: incidents.severity })
        .from(incidents)
        .where(eq(incidents.code, "start.unplanned_stop"));
      expect(rows).toEqual(
        previousStop.restart || previousStop.heartbeatAt === null
          ? []
          : [
              {
                severity: "warning",
                params: { lastRunningAt: heartbeatAt, lastRunningOffsetMinutes: 120 },
              },
            ],
      );
    },
  );
});

it.each([false, true])(
  "only the signal handler's restart operation writes a mark (signal %s)",
  async (signal) => {
    const venue = await setupVenue(suite.db);
    let markFile: string;
    await withTradingBootServer(
      {
        db: suite.db,
        nodeId: venue.cfg.nodeId,
        scratchPrefix: "waitron-boot-mark-",
        start: async (env) => {
          markFile = join(env.WAITRON_STATE_DIR!, "stop-mark.json");
          const server = await startServer(env, env, { boxHost: synchronisedBoxHost() });
          return {
            ...server,
            close: async () => {
              try {
                if (signal) {
                  await server.markRestart?.();
                  expect(await readFile(markFile, "utf8")).toBe('{"version":1,"mark":"restart"}');
                }
              } finally {
                await server.close();
              }
              if (!signal) await expect(stat(markFile)).rejects.toMatchObject({ code: "ENOENT" });
            },
          };
        },
        httpPort,
      },
      async () => {},
    );
  },
);

it("stops admissions before saving the replacement and stays stopped after an offline restart", async () => {
  const { cfg, key, streamId } = await configureStartupBucket();
  const ring = loadKeyRing(TRADING_BOOT_KEY_ENV);
  const bucket = new SwitchableStore(() => new Date());
  const restart = vi.fn();
  let releaseFirst!: () => void;
  let releaseSecond!: () => void;
  const first = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const second = new Promise<void>((resolve) => {
    releaseSecond = resolve;
  });
  const write = atomic.writeFileDurable;
  let attempts = 0;
  const saved = vi.spyOn(atomic, "writeFileDurable").mockImplementation(async (...args) => {
    if (args[0].endsWith("/replaced.json")) {
      attempts++;
      if (attempts === 1) {
        await first;
        throw Object.assign(new Error("disk full"), { code: "ENOSPC" });
      }
      await second;
    }
    await write(...args);
  });
  let env: Record<string, string>;
  let mdns: ReturnType<typeof fakeMdnsSocket>;
  const boot = (vars: Record<string, string>) => {
    mdns = fakeMdnsSocket();
    return startServer(
      { ...vars, WAITRON_HTTP_HOST: "0.0.0.0", WAITRON_BOX_ADDRESSES: "192.0.2.10" },
      vars,
      {
        boxHost: synchronisedBoxHost(),
        stream: { store: bucket, mainCheckIntervalMs: 5 },
        mdnsSocket: () => mdns.socket,
        restart,
      },
    );
  };
  const answers = () => {
    mdns.clear();
    mdns.query(boxHostnameFor(cfg.nodeId));
    mdns.query("waitron.local");
    return mdns.answered();
  };
  const probe = async (origin: string) =>
    (await fetch(`${origin}/api/node`)).json() as Promise<{ acceptingSales: boolean }>;
  const smtp = await startFakeSmtp();
  const record = vi
    .spyOn(stopAlert, "recordReplacement")
    .mockRejectedValueOnce(new AppError("storage.disk_full", {}));
  try {
    await withTransaction(suite.db, (tx) =>
      saveSmtpForTest(tx, ring, {
        url: `smtp://127.0.0.1:${smtp.port}`,
        from: "notices@example.test",
      }),
    );
    await withTradingBootServer(
      {
        db: suite.db,
        nodeId: cfg.nodeId,
        scratchPrefix: "waitron-boot-replaced-",
        start: (vars) => {
          env = vars;
          return boot(vars);
        },
        httpPort,
      },
      async (base) => {
        try {
          expect(await probe(base)).toMatchObject({ acceptingSales: true });
          expect(answers()).toEqual([boxHostnameFor(cfg.nodeId), "waitron.local"]);
          const pointer = signPointer(
            {
              streamId,
              nodeId: cfg.nodeId,
              term: 1,
              generation: `gen-1-${cfg.nodeId}-20261022T093100Z`,
              writtenAt: heartbeatAt,
            },
            key,
          );
          await bucket.put(pointerKey(), new TextEncoder().encode(JSON.stringify(pointer)));
          await vi.waitFor(() => expect(attempts).toBe(1), { timeout: 2_000 });
          expect(await probe(base)).toMatchObject({ acceptingSales: false });
          const refused = await fetch(`${base}/api/attendance/commands`, { method: "POST" });
          expect(refused.status).toBe(503);
          expect(await refused.json()).toMatchObject({ error: { code: "handover.stepping_down" } });
          expect(answers()).toEqual([]);
          bucket.down = true;
          releaseFirst();
          await vi.waitFor(() => expect(attempts).toBe(2), { timeout: 2_000 });
          expect(await probe(base)).toMatchObject({ acceptingSales: false });
          expect(restart).not.toHaveBeenCalled();
          releaseSecond();
          await vi.waitFor(() => expect(restart).toHaveBeenCalledOnce());
          const markFile = join(env.WAITRON_STATE_DIR!, "replaced.json");
          expect(JSON.parse(await readFile(markFile, "utf8"))).toMatchObject({
            streamId,
            nodeId: cfg.nodeId,
            term: 1,
          });

          const now = new Date();
          await stopAlert.recordUnexpectedStop(suite.db, heartbeatAt, now);
          const oldClaim = await withTransaction(suite.db, async (tx) => {
            const [owner] = await tx
              .select({ id: persons.id })
              .from(persons)
              .where(eq(persons.email, "owner@example.test"));
            const { id } = await enqueueMail(tx, {
              kind: "box_alert",
              dedupeKey: "old-alert",
              personId: owner!.id,
              params: { code: "storage.space_low" },
              now,
              notAfter: new Date(now.getTime() + 60_000),
            });
            await tx
              .update(outgoingMail)
              .set({
                status: "sending",
                claimToken: "old-claim",
                claimedAt: now.toISOString(),
                recipient: "owner@example.test",
              })
              .where(eq(outgoingMail.id, id));
            return id;
          });
          const held = await boot(env);
          try {
            const offline = `http://127.0.0.1:${httpPort()}`;
            expect(await probe(offline)).toMatchObject({ acceptingSales: false });
            expect(answers()).toEqual([]);
            const response = await fetch(offline, { headers: { "Accept-Language": "en" } });
            const page = await response.text();
            expect(page).toContain("Leave this box switched off");
            expect(page).toContain('href="/help/en/backup-recovery#replaced-box"');
            expect((await fetch(`${offline}/carry-on`, { method: "POST" })).status).toBe(404);
            await vi.waitFor(() => expect(smtp.messages).toHaveLength(1), { timeout: 10_000 });
            expect(record).toHaveBeenCalledTimes(2);
            expect(smtp.messages[0]).toContain("To: owner@example.test");
            const rows = await suite.db
              .select({ code: incidents.code })
              .from(incidents)
              .where(eq(incidents.code, "start.replaced"));
            expect(rows).toEqual([{ code: "start.replaced" }]);
            const mail = await suite.db
              .select({
                id: outgoingMail.id,
                status: outgoingMail.status,
                params: outgoingMail.params,
              })
              .from(outgoingMail);
            expect(mail).toEqual(
              expect.arrayContaining([
                expect.objectContaining({ id: oldClaim, status: "unknown" }),
                expect.objectContaining({ params: { code: "start.replaced", wording: null } }),
              ]),
            );
            expect(mail).toHaveLength(2);
          } finally {
            await held.close();
          }
        } finally {
          releaseFirst();
          releaseSecond();
        }
      },
    );
  } finally {
    saved.mockRestore();
    record.mockRestore();
    await smtp.close();
  }
}, 30_000);
