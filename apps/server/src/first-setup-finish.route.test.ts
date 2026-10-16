import { vi } from "vitest";
import { openVenueDatabase } from "@waitron/db";
import { parseEnvFile } from "./env-file.js";
import { ALL_MODULES } from "@waitron/composition";
import { Hono } from "hono";
import { randomBytes } from "node:crypto";
import { readFile, rm, stat, symlink } from "node:fs/promises";
import { join } from "node:path";
import { Agent } from "undici";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { TEST_MIGRATIONS } from "@waitron/fiscal-verifactu/test/migrations.js";
import { fiscalAllocations } from "@waitron/fiscal-verifactu/src/schema/allocations.js";
import { loadKeyRing } from "@waitron/credentials";
import { parseModuleConfig } from "@waitron/module";
import { declaredFirstFiscalFixture, publicDigest } from "../test/declared-first-fiscal.js";
import { createFirstSetupModuleHost } from "./module-operation-host.js";
import { activateFirstFiscal } from "./first-fiscal-activation.js";
import { mountFirstSetupResolutionApi } from "./setup-first-fiscal-api.js";
import { provisionVenue, recoverProvisionedVenue, venueModuleConfig } from "./provision.js";
import { establishNodeIdentity } from "./node-identity.js";
import { seedTermZeroMembership } from "./membership-seed.js";
import { ensureBoxSecrets } from "./box-secrets.js";
import { serveRecovery, startServerOrFirstSetupResolution } from "./node-entry.js";
import { freePorts } from "./testing/free-ports.js";
import type { SetupDeps } from "./setup-api.js";

vi.mock("@waitron/composition", async (original) => {
  const actual = await original<typeof import("@waitron/composition")>();
  return {
    ...actual,
    ALL_MODULES: actual.ALL_MODULES.map((m) =>
      m.name !== "fiscal-verifactu"
        ? m
        : {
            ...m,
            fiscal: {
              ...m.fiscal!,
              provisioningSecret: {
                required: () => false,
                validate: () => {},
                seal: async () => {},
              },
            },
          },
    ),
  };
});
const suite = useVenueDb({ migrations: TEST_MIGRATIONS });
const publication = {
  mode: "live",
  email: {
    server: "smtp.example.test",
    port: 465,
    encryption: "tls",
    user: "",
    password: "",
    from: "venue@example.test",
  },
};

async function fixture(realEntry = false, withoutBookings = false) {
  const f = await declaredFirstFiscalFixture({
    modules: ALL_MODULES,
    ...(withoutBookings
      ? { moduleConfig: parseModuleConfig({ modules: { bookings: false } }, ALL_MODULES) }
      : {}),
    extendHistory: (history) => history,
  });
  let server: Awaited<ReturnType<typeof serveRecovery>> | undefined;
  let agent: Agent | undefined;
  let entryServer: { close(): Promise<void> } | undefined;
  try {
    const modules = f.modules.map((m) =>
      m.name !== f.module
        ? m
        : {
            ...m,
            fiscal: {
              ...m.fiscal!,
              provisioningSecret: {
                required: () => false,
                validate: () => {},
                seal: async () => {},
              },
            },
          },
    );
    const host = createFirstSetupModuleHost({ ...f, modules, environment: {} });
    const staged = await host.keys.stageInitialNodeKey(
      f.ownerAttempt,
      await host.owner.reconfirm(f.ownerAttempt, f.password, "block-use"),
    );
    const ref = {
      module: f.module,
      stageId: staged.stage.stageId,
      inputDigest: publicDigest(f.input),
      historyDigest: f.statement.delivery.historyDigest,
      documentDigest: f.statement.delivery.documentDigest,
    };
    await host.delivery.registerFirstFiscalDelivery(f.ownerAttempt, {
      ...ref,
      statement: f.statement,
    });
    await host.delivery.confirmFirstFiscalDocumentKept(
      f.ownerAttempt,
      { ...ref, kept: true },
      await host.owner.reconfirm(f.ownerAttempt, f.password, "activation"),
    );
    const ring = loadKeyRing({ WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 12).toString("base64") });
    let activations = 0,
      publications = 0,
      opens = 0,
      restart = 0;
    const deps: SetupDeps = {
      environment: "production",
      db: suite.db,
      ring,
      provision: async (req, beforeTransaction) => {
        activations++;
        return provisionVenue(
          {
            ownerDb: suite.db,
            stateDir: f.stateDir,
            database: "synthetic",
            moduleConfig: venueModuleConfig(
              f.moduleConfig ?? parseModuleConfig({}, f.modules),
              req.venue.location.fiscalTerritory,
            ),
            beforeTransaction,
          },
          req,
          host.modules,
        );
      },
      recoverProvision: (req) => recoverProvisionedVenue(suite.db, req, host.modules),
      assertFiscalReady: async () => {},
      establishIdentity: async () => {
        throw new Error("interrupted publication");
      },
      seedMembership: (nodeId) =>
        seedTermZeroMembership({ db: suite.db, ring }, nodeId, "https://test.example"),
      persistTrading: async () => {
        publications++;
      },
    };
    await expect(
      host.coordinator.run((hold) =>
        activateFirstFiscal(host, deps, f.ownerAttempt, publication, hold),
      ),
    ).rejects.toThrow("interrupted publication");
    const rows = await suite.db.select().from(fiscalAllocations);
    await ensureBoxSecrets({
      stateDir: f.stateDir,
      hostnames: ["localhost"],
      now: () => new Date(),
      listIpv4: () => ["127.0.0.1"],
    });
    const app = new Hono();
    mountFirstSetupResolutionApi(app, host, () => {}, {
      withPublication: async (body) => {
        opens++;
        return body({
          ...deps,
          provision: undefined,
          assertFiscalReady: undefined,
          establishIdentity: (nodeId) => establishNodeIdentity({ ownerDb: suite.db, ring }, nodeId),
        });
      },
      requestRestart: () => {
        restart++;
      },
    });
    const [port] = await freePorts(1);
    if (realEntry) {
      await suite.db.archiveTo(join(f.venueDir, "venue.db"));
      entryServer = await startServerOrFirstSetupResolution(
        {
          WAITRON_ENV: "production",
          WAITRON_STATE_DIR: f.stateDir,
          WAITRON_VENUE_DIR: f.venueDir,
          WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 12).toString("base64"),
          WAITRON_HTTP_PORT: String(port),
          WAITRON_HTTP_HOST: "127.0.0.1",
          WAITRON_HTTP_LANDING_PORT: "0",
          WAITRON_MANAGEMENT_RP_ID: "localhost",
          WAITRON_MANAGEMENT_ORIGIN: "https://localhost",
        },
        {},
        {
          requestRestart: () => {
            restart++;
          },
        },
      );
    } else
      server = await serveRecovery(app, {
        stateDir: f.stateDir,
        port,
        httpHost: "127.0.0.1",
        log: () => {},
      });
    agent = new Agent({ connect: { ca: await readFile(join(f.stateDir, "tls/ca.crt")) } });
    const origin = `https://127.0.0.1:${port}`;
    const post = (
      action: string,
      body: unknown,
      owner?: {
        capability: string;
        state: { attemptId: string; revision: number; ownerGeneration: number };
      },
      extra = {},
    ) =>
      fetch(`${origin}/setup-api/first-setup/resolution/${action}`, {
        dispatcher: agent,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: origin,
          ...(owner === undefined
            ? {}
            : {
                "X-Waitron-Setup-Owner": owner.capability,
                "X-Waitron-Setup-Attempt": owner.state.attemptId,
                "X-Waitron-Setup-Revision": String(owner.state.revision),
                "X-Waitron-Setup-Generation": String(owner.state.ownerGeneration),
              }),
          ...extra,
        },
        body: JSON.stringify(body),
      } as RequestInit);
    const inspect = () => host.resolution.inspectFirstSetupResolution();
    const snapshot = async () => {
      const s = await inspect();
      return {
        inspectionId: s.inspectionId,
        revision: s.revision,
        ownerGeneration: s.ownerGeneration,
      };
    };
    const recover = async () => {
      const response = await post("recover", {
        ...(await snapshot()),
        password: f.password,
        clientClaimNonce: randomBytes(32).toString("base64url"),
      });
      expect(response.status).toBe(200);
      return response.json();
    };
    return {
      ...f,
      host,
      ref,
      rows,
      post,
      snapshot,
      recover,
      publicationDetails: (owner: {
        capability: string;
        state: { attemptId: string; revision: number; ownerGeneration: number };
      }) =>
        fetch(`${origin}/setup-api/first-setup/resolution/publication`, {
          dispatcher: agent,
          headers: {
            "X-Waitron-Setup-Owner": owner.capability,
            "X-Waitron-Setup-Attempt": owner.state.attemptId,
            "X-Waitron-Setup-Revision": String(owner.state.revision),
            "X-Waitron-Setup-Generation": String(owner.state.ownerGeneration),
          },
        } as RequestInit),
      counts: () => ({ activations, publications, opens, restart }),
      dispose: async () => {
        if (server)
          await new Promise<void>((resolve, reject) =>
            server!.close((e) => (e ? reject(e) : resolve())),
          );
        await entryServer?.close();
        await agent!.close();
        await f.dispose();
      },
    };
  } catch (error) {
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    await entryServer?.close();
    await agent?.close();
    await f.dispose();
    throw error;
  }
}

it("HTTPS Finish publishes the exact committed setup after fresh document confirmation without activation", async () => {
  const f = await fixture();
  try {
    const owner = await f.recover();
    const confirm = await f.post(
      "reconfirm",
      { password: f.password, purpose: "activation" },
      owner,
    );
    expect(confirm.status).toBe(200);
    const document = await f.post(
      "document",
      { ...f.ref, statement: { ...f.statement, priorActivation: "committed" } },
      owner,
    );
    expect(document.status).toBe(200);
    const kept = await f.post(
      "document-kept",
      { ...f.ref, kept: true, reconfirmation: (await confirm.json()).reconfirmation },
      owner,
    );
    expect(kept.status).toBe(200);
    const response = await f.post("finish", { ...(await f.snapshot()), publication }, owner);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ provisioned: true, restarting: true });
    await vi.waitFor(() =>
      expect(f.counts()).toEqual({ activations: 1, publications: 1, opens: 1, restart: 1 }),
    );
    expect(await suite.db.select().from(fiscalAllocations)).toEqual(f.rows);
    expect((await f.host.store.read())?.status).toBe("complete");
  } finally {
    await f.dispose();
  }
});

it("Finish rejects missing ownership, stale inspection, foreign origins and private extra fields before opening the database", async () => {
  const f = await fixture();
  try {
    const owner = await f.recover();
    const body = { ...(await f.snapshot()), publication };
    for (const c of [
      { body, owner: undefined, headers: {}, status: 403, code: "setup.owner_required" },
      {
        body: { ...body, inspectionId: "c".repeat(64) },
        owner,
        headers: {},
        status: 409,
        code: "setup.attempt_conflict",
      },
      {
        body,
        owner,
        headers: { Origin: "https://foreign.example" },
        status: 403,
        code: "setup.owner_required",
      },
      {
        body: { ...body, path: f.root },
        owner,
        headers: {},
        status: 400,
        code: "setup.request_invalid",
      },
    ]) {
      const response = await f.post("finish", c.body, c.owner, c.headers);
      expect(response.status).toBe(c.status);
      expect(await response.json()).toMatchObject({ error: { code: c.code } });
      expect(f.counts()).toEqual({ activations: 1, publications: 0, opens: 0, restart: 0 });
    }
    expect(await suite.db.select().from(fiscalAllocations)).toEqual(f.rows);
  } finally {
    await f.dispose();
  }
});

it("the real direct entry can finish its retained database and publish trading settings without ordinary boot", async () => {
  const f = await fixture(true);
  try {
    const owner = await f.recover();
    const document = await f.post(
      "document",
      { ...f.ref, statement: { ...f.statement, priorActivation: "committed" } },
      owner,
    );
    expect(document.status).toBe(200);
    const confirm = await f.post(
      "reconfirm",
      { password: f.password, purpose: "activation" },
      owner,
    );
    expect(confirm.status).toBe(200);
    expect(
      (
        await f.post(
          "document-kept",
          { ...f.ref, kept: true, reconfirmation: (await confirm.json()).reconfirmation },
          owner,
        )
      ).status,
    ).toBe(200);
    const response = await f.post("finish", { ...(await f.snapshot()), publication }, owner);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ provisioned: true, restarting: true });
    const settings = parseEnvFile(await readFile(join(f.stateDir, "trading.env"), "utf8"));
    expect(settings).toMatchObject({
      WAITRON_TILL_NODE_ID: owner.state.nodeId,
      WAITRON_ENV: "production",
      WAITRON_ONBOARDING_INTENT: "live",
    });
    const opened = await openVenueDatabase(f.venueDir);
    try {
      expect(await opened.venue.select().from(fiscalAllocations)).toEqual(f.rows);
    } finally {
      await opened.close();
    }
    expect((await f.host.store.read())?.status).toBe("complete");
    await vi.waitFor(() => expect(f.counts().restart).toBe(1));
  } finally {
    await f.dispose();
  }
});

it("Finish on a newly missing retained database refuses without recreating it", async () => {
  const f = await fixture(true);
  try {
    const owner = await f.recover();
    await rm(join(f.venueDir, "venue.db"));
    const response = await f.post("finish", { ...(await f.snapshot()), publication }, owner);
    await expect(stat(join(f.venueDir, "venue.db"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "setup.attempt_uncertain" } });
    await expect(stat(join(f.stateDir, "trading.env"))).rejects.toMatchObject({ code: "ENOENT" });
    expect((await f.host.store.read())?.status).toBe("committed");
    expect(f.counts().restart).toBe(0);
  } finally {
    await f.dispose();
  }
});

it("Finish cannot reuse the interrupted process's outside-document grant after ownership recovery", async () => {
  const f = await fixture(true);
  try {
    const owner = await f.recover();
    const response = await f.post("finish", { ...(await f.snapshot()), publication }, owner);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "sif.allocation_invalid" } });
    expect((await f.host.store.read())?.status).toBe("committed");
    await expect(stat(join(f.stateDir, "trading.env"))).rejects.toMatchObject({ code: "ENOENT" });
    const opened = await openVenueDatabase(f.venueDir);
    try {
      expect(await opened.venue.select().from(fiscalAllocations)).toEqual(f.rows);
    } finally {
      await opened.close();
    }
  } finally {
    await f.dispose();
  }
});

it.each(["reconfirm", "document", "document-kept", "finish", "publication"])(
  "plain HTTP refuses resolution %s before parsing private inputs",
  async (action) => {
    const { firstFiscalFixture } = await import("../test/first-fiscal.js");
    const f = await firstFiscalFixture();
    let server: { close(): Promise<void> } | undefined;
    try {
      const [port] = await freePorts(1);
      server = await startServerOrFirstSetupResolution({
        WAITRON_STATE_DIR: f.stateDir,
        WAITRON_VENUE_DIR: f.venueDir,
        WAITRON_HTTP_HOST: "127.0.0.1",
        WAITRON_HTTP_PORT: String(port),
        WAITRON_HTTP_LANDING_PORT: "0",
      });
      const response = await fetch(
        `http://127.0.0.1:${port}/setup-api/first-setup/resolution/${action}`,
        {
          method: action === "publication" ? "GET" : "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Forwarded-Proto": "https",
            "X-Waitron-Setup-Owner": f.ownerAttempt.capability,
            "X-Waitron-Setup-Attempt": f.ownerAttempt.attemptId,
            "X-Waitron-Setup-Revision": String(f.ownerAttempt.revision),
            "X-Waitron-Setup-Generation": String(f.ownerAttempt.ownerGeneration),
          },
          ...(action === "publication" ? {} : { body: "not JSON" }),
        },
      );
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({
        error: { code: "setup.owner_required", params: {} },
      });
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      await expect(stat(join(f.venueDir, "venue.db"))).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await server?.close();
      await f.dispose();
    }
  },
);

it("a recovered HTTPS client can rediscover its frozen publication reference without revealing secrets or rekeying", async () => {
  const f = await fixture(true);
  try {
    const owner = await f.recover();
    const before = await readFile(join(f.stateDir, "first-setup-node-key.json"));
    const response = await f.publicationDetails(owner);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const details = await response.json();
    expect(details.stage).toEqual({
      stageId: f.ref.stageId,
      nodeId: owner.state.nodeId,
      name: expect.any(String),
    });
    expect(details.modules.find((m: { module: string }) => m.module === f.module).input).toEqual(
      f.input,
    );
    expect(details.state).toEqual(owner.state);
    const text = JSON.stringify(details);
    for (const secret of [f.password, f.root, "verifier", "passwordHash", "pinHash"])
      expect(text).not.toContain(secret);
    expect(await readFile(join(f.stateDir, "first-setup-node-key.json"))).toEqual(before);
  } finally {
    await f.dispose();
  }
});

it("publication refuses a symlinked reserved node database before opening another folder's file", async () => {
  const f = await fixture(true);
  try {
    const owner = await f.recover();
    const outside = join(f.root, "outside.db");
    await suite.db.archiveTo(outside);
    const before = await readFile(outside);
    await symlink(outside, join(f.venueDir, "node.db"));
    const response = await f.post("finish", { ...(await f.snapshot()), publication }, owner);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "setup.attempt_uncertain" } });
    expect(await readFile(outside)).toEqual(before);
    await expect(stat(join(f.stateDir, "trading.env"))).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    await f.dispose();
  }
});

it("publication recovery retains an explicitly disabled optional module", async () => {
  const f = await fixture(true, true);
  try {
    const owner = await f.recover();
    const response = await f.publicationDetails(owner);
    expect(response.status).toBe(200);
    const details = await response.json();
    expect(details.state.modules.some((m: { module: string }) => m.module === "bookings")).toBe(
      false,
    );
    expect(
      (
        await f.post(
          "document",
          { ...f.ref, statement: { ...f.statement, priorActivation: "committed" } },
          owner,
        )
      ).status,
    ).toBe(200);
    const reconfirm = await f.post(
      "reconfirm",
      { password: f.password, purpose: "activation" },
      owner,
    );
    expect(reconfirm.status).toBe(200);
    expect(
      (
        await f.post(
          "document-kept",
          { ...f.ref, kept: true, reconfirmation: (await reconfirm.json()).reconfirmation },
          owner,
        )
      ).status,
    ).toBe(200);
    expect((await f.post("finish", { ...(await f.snapshot()), publication }, owner)).status).toBe(
      200,
    );
    expect(
      JSON.parse(await readFile(join(f.stateDir, "modules.json"), "utf8")).modules.bookings,
    ).toBe(false);
  } finally {
    await f.dispose();
  }
});
