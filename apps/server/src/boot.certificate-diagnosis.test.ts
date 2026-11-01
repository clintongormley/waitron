import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { stampDeployment, writeNodeMembership } from "@waitron/db";
import { setNodeMode, writeMirrorLink } from "@waitron/node-db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { emptyDrainResult } from "@waitron/fiscal";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import * as diagnosis from "./fiscal-certificate-diagnosis-runner.js";
import { ephemeralServerFixture } from "./testing/ephemeral-server-fixture.js";
import { copyMigrationsRoot } from "./testing/boot-harness.js";
import { freePorts } from "./testing/free-ports.js";
import { setupVenue } from "./testing/venue-fixtures.js";
import { signedMembershipDoc } from "./testing/membership-doc-fixture.js";
import type { StartedServer } from "./boot.js";

const mode = vi.hoisted(() => ({ noDiagnosis: false, failAfterMount: false }));
vi.mock("@hono/node-server", async () =>
  (await import("./testing/ephemeral-listener.js")).ephemeralHttpMock(),
);
vi.mock("@waitron/module", async (original) => {
  const actual = await original<typeof import("@waitron/module")>();
  return {
    ...actual,
    fiscalSlot: (...args: Parameters<typeof actual.fiscalSlot>) => {
      const fiscal = actual.fiscalSlot(...args);
      const certificate = fiscal.certificate && {
        read: fiscal.certificate.read,
        install: fiscal.certificate.install,
        alerts: fiscal.certificate.alerts,
        reminders: fiscal.certificate.reminders,
      };
      return {
        ...fiscal,
        drain: async () => emptyDrainResult(),
        certificate: mode.noDiagnosis ? certificate : fiscal.certificate,
      };
    },
  };
});
vi.mock("./email-inbox-api.js", async (original) => {
  const actual = await original<typeof import("./email-inbox-api.js")>();
  return {
    ...actual,
    mountEmailInboxApi: (...args: Parameters<typeof actual.mountEmailInboxApi>) => {
      if (mode.failAfterMount) throw new Error("diagnosis failed-start control");
      return actual.mountEmailInboxApi(...args);
    },
  };
});
const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
const { startServer, beforeServerStarts, httpPort } = ephemeralServerFixture();
const path = "/management-api/fiscal-certificate/diagnose";
const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
  vi.restoreAllMocks();
  mode.noDiagnosis = false;
  mode.failAfterMount = false;
});
const actualRunner = diagnosis.createCertificateDiagnosisRunner;
function observeRunners(stopped?: () => Promise<void>) {
  const created: {
    runner: diagnosis.CertificateDiagnosisRunner;
    stop: ReturnType<typeof vi.fn>;
    attempt: ReturnType<typeof vi.fn>;
  }[] = [];
  const factory = vi
    .spyOn(diagnosis, "createCertificateDiagnosisRunner")
    .mockImplementation((options) => {
      const runner = actualRunner(options);
      const stop = vi.fn(async () => {
        await runner.stop();
        await stopped?.();
      });
      const attempt = vi.fn(runner.attempt);
      created.push({ runner, stop, attempt });
      return { stop, attempt };
    });
  return { created, factory };
}
async function prepared(posture: "primary" | "mirror" | "fenced" = "primary", filing = false) {
  beforeServerStarts();
  const venue = await setupVenue(suite.db);
  if (posture !== "primary") {
    await stampDeployment(suite.db, "preproduction");
    if (posture === "mirror") {
      await setNodeMode({ venue: suite.db, node: suite.node }, venue.cfg.nodeId, "mirror");
      await writeMirrorLink(suite.node, venue.cfg.nodeId, {
        relayUrl: "https://127.0.0.1:1/",
        boxHostname: "box.test",
        boxCaPem: "unused",
        originNodeId: venue.cfg.nodeId,
      });
    } else
      await writeNodeMembership(
        suite.db,
        signedMembershipDoc(1, {
          signerNodeId: venue.cfg.nodeId,
          nodes: [
            { nodeId: venue.cfg.nodeId, contactUrl: "https://box.test", standing: "sell-only" },
          ],
        }),
      );
  }
  const scratch = await mkdtemp(join(tmpdir(), "diagnosis-boot-"));
  cleanups.push(() => rm(scratch, { recursive: true, force: true }));
  await copyMigrationsRoot(join(scratch, "migrations"));
  await writeFile(
    join(scratch, "modules.json"),
    JSON.stringify({ modules: { "fiscal-none": false } }),
  );
  const database = suite.db.all<{ file: string }>(sql`pragma database_list`)[0]!.file;
  const [port] = await freePorts(1);
  return {
    venue,
    env: {
      WAITRON_HTTP_LANDING_PORT: "0",
      WAITRON_HTTP_PORT: String(port),
      WAITRON_STATE_DIR: scratch,
      WAITRON_VENUE_DIR: dirname(database),
      WAITRON_NODE_ID: venue.cfg.nodeId,
      WAITRON_MIGRATIONS_DIR: join(scratch, "migrations"),
      WAITRON_ENV: "preproduction",
      WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 5).toString("base64"),
      WAITRON_CREDENTIALS_KEY_VERSION: "1",
      ...(filing ? { WAITRON_FISCAL_TEST_SUBMISSIONS: "enabled" } : {}),
    },
  };
}
async function start(f: Awaited<ReturnType<typeof prepared>>) {
  const server = await startServer(f.env);
  cleanups.push(() => server.close());
  return server;
}
function post(cookie?: string) {
  return fetch(`http://127.0.0.1:${httpPort()}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify({
      schemaVersion: 1,
      source: "installed",
      operation: "inspect",
      sourceGeneration: 1,
      expectedRevision: null,
    }),
  });
}
const sessions = () => suite.db.all(sql`select * from management_sessions order by id`);

describe("certificate diagnosis ownership at real boot", () => {
  it("registers the optional route on a non-filing box but refuses work without session activity", async () => {
    const f = await prepared();
    await start(f);
    const before = sessions();
    const response = await post(f.venue.managerCookie);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: { code: "fiscal.certificate_not_used", params: {} },
    });
    expect(sessions()).toEqual(before);
  });
  it("keeps the existing read/install seat compatible when diagnosis is absent", async () => {
    mode.noDiagnosis = true;
    const observer = observeRunners();
    const f = await prepared();
    await start(f);
    expect((await post(f.venue.managerCookie)).status).toBe(404);
    expect(observer.created).toHaveLength(0);
    const card = await fetch(`http://127.0.0.1:${httpPort()}/management-api/fiscal-certificate`, {
      headers: { cookie: f.venue.managerCookie },
    });
    expect(card.status).toBe(200);
  });
  it.each(["mirror", "fenced"] as const)(
    "%s retains the outer read-only refusal before any ambient-session refresh",
    async (posture) => {
      const f = await prepared(posture, true);
      const observer = observeRunners();
      await start(f);
      const before = sessions();
      const response = await post();
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: { code: "node.read_only", params: {} } });
      expect(sessions()).toEqual(before);
      for (const { attempt } of observer.created) expect(attempt).not.toHaveBeenCalled();
    },
  );
  it("one runner is stopped and settled before normal shutdown returns", async () => {
    const observer = observeRunners();
    const f = await prepared("primary", true);
    const server: StartedServer = await start(f);
    const before = sessions();
    const response = await post(f.venue.managerCookie);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      category: "local-finding",
      localFinding: "missing",
    });
    expect(sessions()).toEqual(before);
    expect(observer.created).toHaveLength(1);
    expect(observer.factory).toHaveBeenCalledWith({ fiscalId: "verifactu" });
    await server.close();
    expect(observer.created[0]!.stop).toHaveBeenCalledOnce();
    await expect(
      observer.created[0]!.runner.attempt(async () => null, new AbortController().signal),
    ).rejects.toMatchObject({ code: "fiscal.certificate_diagnosis_unavailable" });
  });
  it("a later failed-start step unwinds the runner that was already created", async () => {
    const observer = observeRunners();
    const f = await prepared();
    mode.failAfterMount = true;
    await expect(startServer(f.env)).rejects.toThrow("diagnosis failed-start control");
    expect(observer.created).toHaveLength(1);
    expect(observer.created[0]!.stop).toHaveBeenCalledOnce();
    await expect(
      observer.created[0]!.runner.attempt(async () => null, new AbortController().signal),
    ).rejects.toMatchObject({ code: "fiscal.certificate_diagnosis_unavailable" });
  });

  it("normal shutdown waits for diagnostic supervision to settle", async () => {
    let started!: () => void;
    const stopping = new Promise<void>((resolve) => {
      started = resolve;
    });
    let release!: () => void;
    const settled = new Promise<void>((resolve) => {
      release = resolve;
    });
    observeRunners(async () => {
      started();
      await settled;
    });
    const f = await prepared();
    const server = await start(f);
    let closed = false;
    const close = server.close().then(() => {
      closed = true;
    });
    try {
      await stopping;
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(closed).toBe(false);
    } finally {
      release();
      await close;
    }
    expect(closed).toBe(true);
  });
});
