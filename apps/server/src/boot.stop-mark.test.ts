import { loadKeyRing } from "@waitron/credentials";
import {
  enqueueMail,
  incidents,
  outgoingMail,
  persons,
  readMail,
  withTransaction,
  writeNodeMembership,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { openManagementSession } from "@waitron/identity/test/fixtures.js";
import { buildNextMembershipDocument } from "@waitron/membership";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { AppError } from "@waitron/shared";
import { pointerKey, signPointer } from "@waitron/stream";
import { SwitchableStore } from "@waitron/stream/testing/switchable-store.js";
import { eq } from "drizzle-orm";
import * as fs from "node:fs";
import { mkdir, mkdtemp, readFile, rm, stat, truncate, writeFile } from "node:fs/promises";
import { Socket } from "node:net";
import { request as httpsRequest } from "node:https";
import { tmpdir } from "node:os";
import { mintMtlsMaterial } from "@waitron/server-kit/testing/mtls.js";
import { join } from "node:path";
import { TLSSocket } from "node:tls";
import type { Hono } from "hono";
import { expect, it, vi } from "vitest";
import { writeArchiveSettings } from "./archive-settings.js";
import { BackupSupervisor } from "./backup-supervisor.js";
import * as atomic from "./fs-atomic.js";
import { startServer as bootServer } from "./boot.js";
import { SHUTDOWN_PAUSED_EMAIL_WORDS } from "./i18n/box-emails.js";
import { boxHostnameFor } from "./box-name.js";
import * as boxEmail from "./box-alert-email.js";
import { seedTermZeroMembership } from "./membership-seed.js";
import { establishNodeIdentity, readNodeIdentityKey } from "./node-identity.js";
import * as stopAlert from "./stop-alert.js";
import { readPreviousStop } from "./stop-mark.js";
import { readStreamSettings, writeStreamSettings } from "./stream-host.js";
import { httpsVia, startFakeSmtp } from "./testing/boot-harness.js";
import {
  copyMigrationsRoot,
  tradingBootEnv,
  TRADING_BOOT_KEY_ENV,
} from "./testing/boot-trading-fixture.js";
import { fakeMdnsSocket } from "./testing/fake-mdns-socket.js";
import { setFreshManagementSignIn } from "./testing/fresh-management-sign-in.js";
import { holdRecoveryKey } from "./testing/recovery-key.js";
import {
  ephemeralServerFixture,
  withTradingBootServer,
} from "./testing/ephemeral-server-fixture.js";
import { setupVenue } from "./testing/venue-fixtures.js";
import { saveSmtpForTest } from "./testing/saved-smtp.js";
import {
  retainHttpListener,
  startWithRetainedListeners,
} from "./testing/retained-http-listener.js";
import { seedModuleSettings } from "../test/module-settings.js";
import { synchronisedBoxHost } from "./testing/synchronised-box-host.js";

vi.mock("@hono/node-server", async () => {
  const { ephemeralHttpMock } = await import("./testing/ephemeral-listener.js");
  return ephemeralHttpMock();
});

vi.mock("node:fs", async (original) => {
  const fs = await original<typeof import("node:fs")>();
  return { ...fs, createReadStream: vi.fn(fs.createReadStream) };
});

const { startServer, startConfiguredServer, httpPort } = ephemeralServerFixture();
const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
const heartbeatAt = "2026-10-22T09:31:00.000Z";

it.each([
  ["drains the scheduled backup and writes only the restart mark if stopped mid-check", "restart"],
  ["refuses checked shutdown while streaming is configured", "streaming"],
  ["refuses checked shutdown when saved backups are disabled", "disabled"],
  ["refuses checked shutdown without a destination or backup key", "no-key"],
  ["records and emails a failed final backup while sales stay paused", "failed"],
  ["multi-destination shutdown offers a saved folder and bucket", "multiple"],
] as const)("%s", async (_description, scenario) => {
  const { cfg } = await setupVenue(suite.db);
  const writeMark = scenario === "multiple" ? vi.spyOn(atomic, "writeFileDurable") : null;
  const { token } = await openManagementSession(suite.db, "admin");
  const { token: staleToken } = await openManagementSession(suite.db, "admin");
  let releaseScheduled!: () => void;
  const held = new Promise<void>((resolve) => {
    releaseScheduled = resolve;
  });
  let enterScheduled!: () => void;
  const scheduled = new Promise<void>((resolve) => {
    enterScheduled = resolve;
  });
  const scheduledBackup = vi
    .spyOn(BackupSupervisor.prototype, "pass")
    .mockImplementation(async (_now, signal) => {
      signal.throwIfAborted();
      signal.addEventListener("abort", releaseScheduled, { once: true });
      try {
        enterScheduled();
        await held;
        return { nextDueAt: null };
      } finally {
        signal.removeEventListener("abort", releaseScheduled);
      }
    });
  let failedChecks = 0;
  let reachedCheck!: () => void;
  const checking = new Promise<void>((resolve) => {
    reachedCheck = resolve;
  });
  let finishCheck!: () => void;
  const checkFinished = new Promise<void>((resolve) => {
    finishCheck = resolve;
  });
  const checkedBackup = vi
    .spyOn(BackupSupervisor.prototype, "runForShutdown")
    .mockImplementation(async (signal) => {
      signal.throwIfAborted();
      if (scenario === "failed") {
        reachedCheck();
        if (++failedChecks === 1)
          throw new AppError("backup.archive_invalid", { reason: "read_back_mismatch" });
        throw new AppError("backup.destination_timed_out", { timeoutMs: 1_000 });
      }
      await new Promise<void>((resolve) => {
        signal.addEventListener("abort", () => resolve(), { once: true });
        reachedCheck();
        if (scenario === "multiple") void checkFinished.then(resolve);
      });
    });
  const smtp = scenario === "failed" ? await startFakeSmtp() : null;
  const ordinaryMailDue = new Date(Date.now() + 30_000);
  if (smtp) vi.useFakeTimers({ toFake: ["Date"] });
  const socket = new TLSSocket(new Socket());
  let app!: Hono;
  let started!: Awaited<ReturnType<typeof startServer>>;
  let stateDir!: string;
  try {
    await withTradingBootServer(
      {
        db: suite.db,
        nodeId: cfg.nodeId,
        scratchPrefix: "waitron-restart-during-shutdown-",
        start: async (env) => {
          stateDir = env.WAITRON_STATE_DIR;
          const dir = join(stateDir, "copies");
          await mkdir(dir);
          if (scenario !== "no-key") await holdRecoveryKey(stateDir);
          const ring = loadKeyRing(TRADING_BOOT_KEY_ENV);
          await withTransaction(suite.db, async (tx) => {
            await setFreshManagementSignIn(tx, token);
            if (scenario !== "no-key")
              await writeArchiveSettings(
                tx,
                ring,
                {
                  enabled: scenario !== "disabled",
                  destinations: [
                    { kind: "local-fs", id: "folder", dir },
                    ...(scenario === "multiple"
                      ? [
                          {
                            kind: "s3" as const,
                            id: "bucket",
                            bucket: {
                              endpoint: "https://127.0.0.1:1",
                              region: "eu-west-1",
                              bucket: "copies",
                              prefix: "",
                              accessKeyId: "test",
                              secretAccessKey: "test-secret",
                            },
                          },
                        ]
                      : []),
                  ],
                  schedule: { kind: "wall-clock", days: "daily", at: { hour: 3, minute: 30 } },
                  retention: { count: 7, days: 30 },
                  destinationTimeoutMs: 15 * 60 * 1000,
                },
                null,
              );
            if (smtp) {
              await saveSmtpForTest(tx, ring, {
                url: `smtp://127.0.0.1:${smtp.port}`,
                from: "notices@example.test",
              });
              const [owner] = await tx
                .select({ id: persons.id })
                .from(persons)
                .where(eq(persons.email, "owner@example.test"));
              await enqueueMail(tx, {
                kind: "security_change",
                dedupeKey: "ordinary-during-shutdown",
                personId: owner!.id,
                params: { change: "password_changed" },
                nextAttemptAt: ordinaryMailDue,
                notAfter: new Date(ordinaryMailDue.getTime() + 60_000),
              });
            }
            if (scenario === "streaming")
              await writeStreamSettings(
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
              );
          });
          started = await startServer(env, env, {
            boxHost: synchronisedBoxHost(),
            stream: { store: new SwitchableStore(() => new Date()) },
            observeApp: (observed) => {
              app = observed;
            },
          });
          return started;
        },
        httpPort,
      },
      async (base) => {
        if (scenario !== "disabled" && scenario !== "no-key") await scheduled;
        const begin = (session: string) =>
          app.request(
            "https://box.example/api/box/shutdown",
            {
              method: "POST",
              headers: { cookie: `waitron_management_session=${session}` },
            },
            { incoming: { socket } },
          );
        const refused = await begin(staleToken);
        expect(refused.status).toBe(400);
        expect(await refused.json()).toMatchObject({
          error: { code: "management_session.proof_required" },
        });
        const health = () =>
          app.request("/api/box/health", {
            headers: { cookie: `waitron_management_session=${token}` },
          });
        if (scenario === "multiple") {
          const view = await health();
          expect(view.status).toBe(200);
          expect(await view.json()).toMatchObject({ shutdown: { available: true, phase: "idle" } });
        }
        const response = await begin(token);
        if (scenario === "streaming" || scenario === "disabled" || scenario === "no-key") {
          releaseScheduled();
          expect(response.status).toBe(409);
          expect(await response.json()).toMatchObject({
            error: { code: "box.shutdown_unavailable" },
          });
          const view = await app.request("/api/box/health", {
            headers: { cookie: `waitron_management_session=${token}` },
          });
          expect(await view.json()).toMatchObject({
            shutdown: { available: false, phase: "idle" },
          });
          return;
        }
        expect(await response.json()).toEqual({ phase: "checking" });
        expect(response.status).toBe(202);
        const view = await app.request("/api/box/status", {
          headers: { cookie: `waitron_management_session=${token}` },
        });
        const enteredCheckEarly = checkedBackup.mock.calls.length !== 0;
        if (smtp) vi.setSystemTime(ordinaryMailDue.getTime() + 1_000);
        releaseScheduled();
        expect(view.status).toBe(200);
        expect(enteredCheckEarly).toBe(false);
        await checking;
        if (scenario === "multiple") {
          const mark = join(stateDir, "admin-shutdown.json");
          const wroteMark = () => writeMark!.mock.calls.some(([file]) => file === mark);
          expect(wroteMark()).toBe(false);
          finishCheck();
          await vi.waitFor(async () => {
            expect(await (await health()).json()).toMatchObject({ shutdown: { phase: "ready" } });
          });
          expect(wroteMark()).toBe(true);
          expect((await stat(mark)).isFile()).toBe(true);
          return;
        }
        if (smtp) {
          const rows = () =>
            suite.db
              .select({ params: incidents.params })
              .from(incidents)
              .where(eq(incidents.code, "start.shutdown_paused"));
          await vi.waitFor(async () => {
            expect(await rows()).toEqual([{ params: { errorCode: "backup.archive_invalid" } }]);
          });
          const shutdownNotices = () =>
            suite.db
              .select({ id: outgoingMail.id })
              .from(outgoingMail)
              .innerJoin(incidents, eq(outgoingMail.subjectId, incidents.id))
              .where(eq(incidents.code, "start.shutdown_paused"))
              .orderBy(outgoingMail.seq);
          await vi.waitFor(async () => expect(await shutdownNotices()).not.toHaveLength(0));
          const firstNotices = await shutdownNotices();
          await vi.waitFor(() => expect(smtp.messages).toHaveLength(firstNotices.length), {
            timeout: 10_000,
          });
          const message = smtp.messages
            .find((mail) => mail.includes("To: owner@example.test"))!
            .replace(/=\r?\n/g, "");
          expect(message).toContain("To: owner@example.test");
          expect(message).toContain(
            SHUTDOWN_PAUSED_EMAIL_WORDS.es.text.split(" ").slice(-3).join(" "),
          );
          expect((await readMail(suite.db, "ordinary-during-shutdown"))?.status).toBe("pending");
          const retry = await app.request(
            "https://box.example/api/box/shutdown",
            {
              method: "PATCH",
              headers: {
                cookie: `waitron_management_session=${token}`,
                "content-type": "application/json",
              },
              body: JSON.stringify({ decision: "retry" }),
            },
            { incoming: { socket } },
          );
          expect(retry.status).toBe(202);
          await vi.waitFor(async () => {
            const health = await app.request("/api/box/health", {
              headers: { cookie: `waitron_management_session=${token}` },
            });
            expect(await health.json()).toMatchObject({
              shutdown: { phase: "paused", errorCode: "backup.destination_timed_out" },
            });
          });
          expect(await rows()).toEqual([{ params: { errorCode: "backup.archive_invalid" } }]);
          expect(await shutdownNotices()).toEqual(firstNotices);
          expect(smtp.messages).toHaveLength(firstNotices.length);
          const trading = await fetch(`${base}/api/node`);
          expect(await trading.json()).toMatchObject({ acceptingSales: false });
          await expect(stat(join(stateDir, "admin-shutdown.json"))).rejects.toHaveProperty(
            "code",
            "ENOENT",
          );
          return;
        }
        await started.markRestart!();
        await started.close();
        expect(await readFile(join(stateDir, "stop-mark.json"), "utf8")).toBe(
          '{"version":1,"mark":"restart"}',
        );
        await expect(stat(join(stateDir, "admin-shutdown.json"))).rejects.toHaveProperty(
          "code",
          "ENOENT",
        );
      },
    );
  } finally {
    writeMark?.mockRestore();
    scheduledBackup.mockRestore();
    checkedBackup.mockRestore();
    socket.destroy();
    if (smtp) vi.useRealTimers();
    await smtp?.close();
  }
});

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

it("holds the next start only after a complete shutdown download and confirmation on HTTPS", async () => {
  const { cfg } = await setupVenue(suite.db);
  const { token } = await openManagementSession(suite.db, "admin");
  const scratch = await mkdtemp(join(tmpdir(), "waitron-boot-shutdown-download-"));
  const { caPem, serverCertPem, serverKeyPem } = mintMtlsMaterial();
  const agent = httpsVia(caPem);
  const name = "checked-backup.backup.enc";
  const bytes = 16 * 1024 * 1024;
  const path = join(scratch, name);
  const mark = join(scratch, "admin-shutdown.json");
  const migrations = join(scratch, "migrations");
  const pem = join(scratch, "server.pem");
  const env = {
    ...tradingBootEnv(suite.db, scratch, cfg.nodeId, migrations),
    WAITRON_HTTP_HOST: "127.0.0.1",
    WAITRON_TLS_CERT_FILE: pem,
    WAITRON_TLS_KEY_FILE: pem,
  };
  const headers = { cookie: `waitron_management_session=${token}` };
  const capture = vi.spyOn(BackupSupervisor.prototype, "runForShutdownDownload");
  const readers = vi.mocked(fs.createReadStream);
  readers.mockClear();
  capture.mockResolvedValue({ name, path, bytes, remove: () => rm(path, { force: true }) });
  const start = async () => {
    const held = await retainHttpListener();
    const server = await startWithRetainedListeners([held], () =>
      startConfiguredServer({ ...env, WAITRON_HTTP_PORT: String(held.port) }, env, {
        boxHost: synchronisedBoxHost(),
      }),
    );
    return { server, origin: `https://127.0.0.1:${held.port}` };
  };
  let box: Awaited<ReturnType<typeof start>> | undefined;
  try {
    await seedModuleSettings(suite.db, { "fiscal-none": false });
    await withTransaction(suite.db, (tx) => setFreshManagementSignIn(tx, token));
    await copyMigrationsRoot(migrations);
    await holdRecoveryKey(scratch);
    await writeFile(pem, serverCertPem + serverKeyPem);
    await writeFile(path, "Checked archive");
    await truncate(path, bytes);
    box = await start();
    const { origin } = box;
    const target = `${origin}/api/box/shutdown`;
    const download = `${target}/download/${name}`;
    const confirm = () =>
      fetch(target, {
        ...agent.via,
        method: "PATCH",
        headers: { ...headers, origin, "content-type": "application/json" },
        body: JSON.stringify({ decision: "backup-saved", name }),
      });
    const view = async () =>
      (await fetch(`${origin}/api/box/health`, { ...agent.via, headers })).json();
    const started = await fetch(target, {
      ...agent.via,
      method: "POST",
      headers: { ...headers, origin },
    });
    expect(started.status).toBe(202);
    expect(await started.json()).toEqual({ phase: "checking" });
    await vi.waitFor(async () =>
      expect(await view()).toMatchObject({
        shutdown: { phase: "download", delivered: false },
      }),
    );
    await new Promise<void>((resolve, reject) => {
      const request = httpsRequest(download, { headers, ca: caPem, agent: false }, (response) => {
        response.once("data", () => {
          request.destroy();
          resolve();
        });
      });
      request.once("error", reject);
      request.end();
    });
    const interruptedReader = readers.mock.calls.findIndex(([source]) => source === path);
    expect(interruptedReader).toBeGreaterThanOrEqual(0);
    await vi.waitFor(() =>
      expect(readers.mock.results[interruptedReader]?.value.closed).toBe(true),
    );
    expect(await view()).toMatchObject({ shutdown: { phase: "download", delivered: false } });
    const incomplete = await confirm();
    expect(incomplete.status).toBe(409);
    expect(await incomplete.json()).toMatchObject({ error: { code: "box.shutdown_in_progress" } });
    await expect(stat(mark)).rejects.toHaveProperty("code", "ENOENT");
    await vi.waitFor(async () => {
      const response = await fetch(download, { ...agent.via, headers });
      expect(response.status).toBe(200);
      expect(response.headers.get("content-disposition")).toBe(`attachment; filename="${name}"`);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect((await response.arrayBuffer()).byteLength).toBe(bytes);
    });
    await vi.waitFor(async () =>
      expect(await view()).toMatchObject({
        shutdown: { phase: "download", delivered: true },
      }),
    );
    const saved = await confirm();
    expect(saved.status).toBe(202);
    await saved.json();
    await vi.waitFor(async () =>
      expect(await view()).toMatchObject({ shutdown: { phase: "ready" } }),
    );
    expect(await readFile(mark, "utf8")).toBe('{"version":1}');
    await expect(stat(path)).rejects.toHaveProperty("code", "ENOENT");
    await box.server.close();
    box = await start();
    const held = await fetch(`${box.origin}/api/node`, agent.via);
    expect(await held.json()).toMatchObject({ acceptingSales: false });
  } finally {
    await box?.server.close();
    await agent.close();
    capture.mockRestore();
    await rm(scratch, { recursive: true, force: true });
  }
}, 30_000);

it.each([false, true])("keeps the shutdown hold across starts (paired: %s)", async (paired) => {
  const { cfg } = await setupVenue(suite.db);
  const confirmedBySpare = vi.fn(async () => ({
    result: "proceed" as const,
    successorNodeId: null,
    hasCountedPeer: true,
  }));
  if (paired) {
    const ring = loadKeyRing(TRADING_BOOT_KEY_ENV);
    await establishNodeIdentity({ ownerDb: suite.db, node: suite.node, ring }, cfg.nodeId);
    await writeNodeMembership(
      suite.db,
      buildNextMembershipDocument({
        heldDocument: null,
        nodes: [
          { nodeId: cfg.nodeId, contactUrl: "https://main.example", standing: "serving-primary" },
          {
            nodeId: "00000000-0000-4000-8000-000000000034",
            contactUrl: "https://spare.example",
            standing: "serving-secondary",
          },
        ],
        signerNodeId: cfg.nodeId,
        signerPrivateKey: await readNodeIdentityKey(suite.node, ring, cfg.nodeId),
      }),
    );
  }
  let started: Awaited<ReturnType<typeof startServer>>;
  let mark: string;
  await withTradingBootServer(
    {
      db: suite.db,
      nodeId: cfg.nodeId,
      scratchPrefix: "waitron-boot-shutdown-hold-",
      start: async (env) => {
        mark = join(env.WAITRON_STATE_DIR!, "admin-shutdown.json");
        await writeFile(mark, '{"version":1}');
        const seams = {
          boxHost: synchronisedBoxHost(),
          waitingStart: { secure: () => true },
          previousStop: { restart: false, heartbeatAt },
          ...(paired ? { peerCheck: confirmedBySpare } : {}),
        };
        const first = await startServer(env, env, seams);
        try {
          expect(first.health.takesNoSales).toBe(true);
        } finally {
          await first.close();
        }
        started = await startServer(env, env, seams);
        return started;
      },
      httpPort,
    },
    async (base) => {
      if (paired) expect(confirmedBySpare).toHaveBeenCalledTimes(2);
      const status = await fetch(`${base}/api/node`);
      expect(await status.json()).toMatchObject({ acceptingSales: false });
      const page = await fetch(base, { headers: { "Accept-Language": "en" } });
      expect(await page.text()).toContain("This box is stopped");
      const submit = (decision: string) =>
        fetch(`${base}/carry-on`, {
          method: "POST",
          body: new URLSearchParams({
            email: "owner@example.test",
            password: "dashPass123",
            decision,
          }),
        });
      const keep = await submit("keep");
      expect(keep.status).toBe(200);
      const keptPage = await keep.text();
      expect(keptPage).toContain("This box is stopped");
      expect(keptPage).toContain('<p role="status">This box will stay stopped.</p>');
      expect(await readFile(mark, "utf8")).toBe('{"version":1}');
      const carry = await submit("carry");
      expect(carry.status).toBe(200);
      await carry.text();
      await started.fullyStarted;
      await expect(stat(mark)).rejects.toHaveProperty("code", "ENOENT");
      const trading = await fetch(`http://127.0.0.1:${httpPort()}/api/node`);
      expect(await trading.json()).toMatchObject({ acceptingSales: true });
      expect(
        await suite.db
          .select({ code: incidents.code })
          .from(incidents)
          .where(eq(incidents.code, "start.unplanned_stop")),
      ).toEqual([]);
    },
  );
});

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
      expect(await probe.json()).toMatchObject({
        standing: "serving-primary",
        acceptingSales: false,
        waitingFor: "bucket",
      });
      const page = await fetch(base, { headers: { "Accept-Language": "en" } });
      const html = await page.text();
      expect(html).toContain("Waiting for the backup bucket");
      expect(html).toContain("This box is checking its backup");
      expect((await fetch(`${base}/carry-on`, { method: "POST" })).status).toBe(404);
      const sale = await fetch(`${base}/api/working-orders/order-1/payments`, { method: "POST" });
      expect(sale.status).toBe(404);
      await sale.text();

      bucket.down = false;
      await started.fullyStarted;
      await vi.waitFor(async () => {
        const trading = await fetch(`http://127.0.0.1:${httpPort()}/api/node`);
        const body: unknown = await trading.json();
        expect(body).toMatchObject({ acceptingSales: true });
        expect(body).not.toHaveProperty("waitingFor");
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
        const message = smtp.messages[0]!.replace(/=\r?\n/g, "");
        expect(message).toContain("To: owner@example.test");
        expect(message).toContain("Al arrancar, el servidor no pudo confirmar");
        expect(message).toContain("tras esperar un minuto");
      },
    );
  } finally {
    schedule.mockRestore();
    await smtp.close();
  }
}, 15_000);

it.each(["waiting", "trading"] as const)(
  "chooses the next startup check when restarted while %s",
  async (phase) => {
    const { cfg } = await configureStartupBucket();
    const bucket = new SwitchableStore(() => new Date());
    bucket.down = phase === "waiting";
    await withTradingBootServer(
      {
        db: suite.db,
        nodeId: cfg.nodeId,
        scratchPrefix: "waitron-boot-bucket-restart-",
        start: async (env) => {
          const seams = {
            boxHost: synchronisedBoxHost(),
            stream: { store: bucket },
          };
          const first = await startServer(env, env, {
            ...seams,
            previousStop: { restart: false, heartbeatAt: null },
          });
          try {
            expect(first.fullyStarted !== undefined).toBe(phase === "waiting");
            await first.markRestart?.();
          } finally {
            await first.close();
          }
          const previousStop = await readPreviousStop(
            { stateDir: env.WAITRON_STATE_DIR!, venueDir: env.WAITRON_VENUE_DIR! },
            () => {},
          );
          expect(previousStop.restart).toBe(phase === "trading");
          bucket.down = true;
          return startServer(env, env, { ...seams, previousStop });
        },
        httpPort,
      },
      async (base) => {
        const probe = await fetch(`${base}/api/node`);
        expect(await probe.json()).toMatchObject({ acceptingSales: phase === "trading" });
        expect(
          await suite.db
            .select({ id: incidents.id })
            .from(incidents)
            .where(eq(incidents.code, "start.selling_unconfirmed")),
        ).toEqual([]);
      },
    );
  },
);

it.each(["peer answered", "deadline spent in the first ask"] as const)(
  "starts trading without opening a waiting listener when %s",
  async (reason) => {
    const { cfg } = await configureStartupBucket();
    const bucket = new SwitchableStore(() => new Date());
    bucket.hang = reason === "deadline spent in the first ask";
    bucket.down = reason === "peer answered";
    await withTradingBootServer(
      {
        db: suite.db,
        nodeId: cfg.nodeId,
        scratchPrefix: "waitron-boot-bucket-direct-",
        start: async (env) => {
          const server = await bootServer(env, env, {
            previousStop: { restart: false, heartbeatAt: null },
            boxHost: synchronisedBoxHost(),
            stream: { store: bucket },
            ...(reason === "peer answered"
              ? {
                  peerCheck: async () => ({
                    result: "proceed" as const,
                    successorNodeId: null,
                    hasCountedPeer: true as const,
                  }),
                }
              : { waitingStart: { bucketWaitMs: 50 } }),
          });
          try {
            expect(server.fullyStarted).toBeUndefined();
            await vi.waitFor(async () => {
              expect((await fetch(`http://127.0.0.1:${httpPort()}/health`)).status).toBe(200);
            });
          } catch (error) {
            await server.close();
            throw error;
          }
          return server;
        },
        httpPort,
      },
      async (base) => {
        const probe = await fetch(`${base}/api/node`);
        expect(await probe.json()).toMatchObject({ acceptingSales: true });
        const alerts = await suite.db
          .select({ id: incidents.id })
          .from(incidents)
          .where(eq(incidents.code, "start.selling_unconfirmed"));
        expect(alerts).toHaveLength(reason === "peer answered" ? 0 : 1);
      },
    );
  },
);

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
