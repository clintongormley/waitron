import { establishNodeIdentity } from "./node-identity.js";
import { seedTermZeroMembership } from "./membership-seed.js";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { invoiceSeries, tenants, nodes } from "@waitron/db";
import { ALL_MODULES } from "@waitron/composition";
import { parseModuleConfig } from "@waitron/module";
import { loadKeyRing } from "@waitron/credentials";
import { TEST_MIGRATIONS } from "@waitron/fiscal-verifactu/test/migrations.js";
import { fiscalAllocations } from "@waitron/fiscal-verifactu/src/schema/allocations.js";
import { createFirstSetupModuleHost } from "./module-operation-host.js";
import { provisionVenue, recoverProvisionedVenue, venueModuleConfig } from "./provision.js";
import { mountSetup, type SetupDeps } from "./setup-api.js";
import { request, PASSWORD, MODULE } from "../test/first-fiscal.js";
import { publicFirstFiscalInput } from "../test/first-fiscal-public.js";

vi.mock("./module-config.js", { spy: true });
const suite = useVenueDb({ migrations: TEST_MIGRATIONS });
const dirs: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
async function fixture(fault?: string) {
  const root = await mkdtemp(join(tmpdir(), "first-interrupt-"));
  dirs.push(root);
  const stateDir = join(root, "state"),
    venueDir = join(root, "venue");
  // The fiscal schema is real; unrelated optional product seeds are disabled in this focused venue.
  const available = ALL_MODULES.filter((m) => ["core", MODULE, "fiscal-none"].includes(m.name)).map(
    (m) =>
      m.name !== MODULE
        ? m
        : {
            ...m,
            fiscal: {
              ...m.fiscal!,
              provisioningSecret: {
                required: () => true,
                validate: () => {},
                seal: async () => {},
              },
            },
          },
  );
  const host = createFirstSetupModuleHost({
    environment: {},
    modules: available,
    stateDir,
    venueDir,
    moduleConfig: parseModuleConfig({}, available),
  });
  let applied = 0,
    publication = 0,
    throwOnce = fault;
  const crash = (point: string) => {
    if (throwOnce === point) {
      throwOnce = undefined;
      throw new Error(`injected ${point}`);
    }
  };
  const deps: SetupDeps = {
    environment: "production",
    db: suite.db,
    ring: loadKeyRing({ WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 8).toString("base64") }),
    firstFiscal: host,
    provision: async (req, beforeTransaction) => {
      applied++;
      return provisionVenue(
        {
          ownerDb: suite.db,
          stateDir,
          database: "synthetic",
          moduleConfig: venueModuleConfig(
            parseModuleConfig({}, ALL_MODULES),
            req.venue.location.fiscalTerritory,
          ),
          beforeTransaction,
          beforeCommit: async () => {
            crash("rollback");
          },
        },
        req,
        host.modules,
      );
    },
    recoverProvision: (req) => recoverProvisionedVenue(suite.db, req, host.modules),
    seedDemo: async () => {},
    establishIdentity: async (nodeId) => {
      await establishNodeIdentity({ ownerDb: suite.db, ring: deps.ring! }, nodeId);
      crash("identity");
    },
    seedMembership: async (nodeId) => {
      await seedTermZeroMembership(
        { db: suite.db, ring: deps.ring! },
        nodeId,
        "https://test.example",
      );
    },
    persistTrading: async () => {
      publication++;
      crash("publication");
    },
    requestRestart: () => {},
    assertFiscalReady: async () => {},
  };
  const app = new Hono();
  mountSetup(app, deps, () => {});
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    app.request(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
  const nonce = randomBytes(32).toString("base64url");
  const claim = await (
    await post("/setup-api/first-setup/claim", { clientClaimNonce: nonce, venue: request })
  ).json();
  let state = claim.state;
  const headers = () => ({
    "X-Waitron-Setup-Owner": claim.capability,
    "X-Waitron-Setup-Attempt": state.attemptId,
    "X-Waitron-Setup-Revision": String(state.revision),
    "X-Waitron-Setup-Generation": String(state.ownerGeneration),
  });
  const reconfirm = async (purpose = "activation") => {
    const res = await post(
      "/setup-api/first-setup/reconfirm",
      { password: PASSWORD, purpose },
      headers(),
    );
    expect(res.status).toBe(200);
    return res.json();
  };
  const chosen = await post(
    "/setup-api/first-setup/candidates",
    { module: MODULE, proposal: { serials: [1] }, ...(await reconfirm("block-use")) },
    headers(),
  );
  expect(chosen.status).toBe(200);
  state = (await chosen.json()).state;
  const exported = await app.request("/setup-api/first-setup/request", { headers: headers() });
  const publicRequest = (await exported.json()).modules[0].request;
  const signed = publicFirstFiscalInput(publicRequest);
  const imported = await post(
    "/setup-api/first-setup/input",
    { module: MODULE, input: signed.input },
    headers(),
  );
  expect(imported.status).toBe(200);
  state = (await imported.json()).state;
  expect(
    (
      await post(
        "/setup-api/first-setup/enrol",
        { module: MODULE, publicKey: signed.key, comparison: signed.key.fingerprint },
        headers(),
      )
    ).status,
  ).toBe(200);
  const confirm = async (prior = "none") => {
    const response = await post(
      "/setup-api/first-setup/current-master",
      {
        module: MODULE,
        statement: { ...signed.current, priorActivation: prior },
        ...(await reconfirm()),
      },
      headers(),
    );
    expect(response.status).toBe(200);
  };
  const refresh = async () => {
    const res = await post("/setup-api/first-setup/resume", {
      clientClaimNonce: nonce,
      password: PASSWORD,
    });
    expect(res.status).toBe(200);
    const next = await res.json();
    state = next.state;
    claim.capability = next.capability;
  };
  const activate = (overrides: Record<string, unknown> = {}) =>
    post(
      "/setup-api/provision",
      {
        mode: "live",
        aeatCert: { synthetic: true },
        email: {
          server: "smtp.example.test",
          port: 465,
          encryption: "tls",
          user: "test",
          password: "test",
          from: "owner@example.test",
        },
        ...overrides,
      },
      headers(),
    );
  return {
    host,
    current: signed.current,
    stateDir,
    claim,
    headers,
    post,
    confirm,
    refresh,
    activate,
    counts: () => ({ applied, publication }),
    db: suite.db,
  };
}
it("activates the frozen assignment once and completes only after host publication", async () => {
  const f = await fixture();
  await f.confirm();
  const response = await f.activate();
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ provisioned: true, restarting: true });
  const state = (await f.host.store.read())!;
  expect(state.status).toBe("complete");
  expect(state.frozen.nodeId).toBe(f.claim.state.nodeId);
  expect((await f.db.select().from(nodes)).map((n) => n.id)).toEqual([f.claim.state.nodeId]);
  expect(await f.db.select().from(fiscalAllocations)).toHaveLength(1);
  expect((await f.db.select().from(invoiceSeries)).map((s) => s.nextNumber)).toEqual([1, 1, 1]);
  expect(f.counts()).toEqual({ applied: 1, publication: 1 });
  const disk = await readFile(join(f.stateDir, "first-setup.json"), "utf8");
  expect(disk).not.toContain('"password":"test"');
});
it.each(["identity", "publication"])(
  "replays a checked committed result after %s without another activation",
  async (fault) => {
    const f = await fixture(fault);
    await f.confirm();
    expect((await f.activate()).status).toBe(500);
    expect(await f.db.select().from(fiscalAllocations)).toHaveLength(1);
    const before = await f.db.select().from(invoiceSeries);
    const beforeNodes = await f.db.select().from(nodes);
    await f.refresh();
    expect((await f.activate()).status).toBe(400);
    await f.confirm("committed");
    expect((await f.activate()).status).toBe(200);
    expect(f.counts().applied).toBe(1);
    expect(await f.db.select().from(invoiceSeries)).toEqual(before);
    expect(await f.db.select().from(nodes)).toEqual(beforeNodes);
    expect((await f.host.store.read())?.status).toBe("complete");
  },
);
it("retains a consumed uncertain assignment after rollback and refuses blind activation", async () => {
  const f = await fixture("rollback");
  await f.confirm();
  expect((await f.activate()).status).toBe(500);
  expect(await f.db.select().from(tenants)).toEqual([]);
  expect(await f.db.select().from(nodes)).toEqual([]);
  expect(await f.db.select().from(fiscalAllocations)).toEqual([]);
  const state = (await f.host.store.read())!;
  expect(state.status).toBe("uncertain");
  expect(state.consumptionIntent).toBe(true);
  await f.refresh();
  expect((await f.activate()).status).toBe(409);
  expect(f.counts().applied).toBe(1);
});

it("lets the original owner read completed outcome after a lost response without reopening activation", async () => {
  const f = await fixture();
  await f.confirm();
  expect((await f.activate()).status).toBe(200);
  const app = new Hono();
  mountSetup(app, { environment: "production", firstFiscal: f.host }, () => {});
  const actual = await app.request("/setup-api/first-setup/status", { headers: f.headers() });
  expect(actual.status).toBe(200);
  expect((await actual.json()).state.status).toBe("complete");
  expect((await f.activate()).status).toBe(403);
  expect(f.counts().applied).toBe(1);
});

it.each([null, [], "smtp.example.test"])(
  "refuses malformed publication email %j without starting activation",
  async (email) => {
    const f = await fixture();
    await f.confirm();
    expect((await f.activate({ email })).status).toBe(400);
    expect(f.counts().applied).toBe(0);
    expect((await f.host.store.read())?.status).toBe("consumption-intent");
  },
);
it("freezes publication secrets across a committed retry", async () => {
  const f = await fixture("publication");
  await f.confirm();
  expect((await f.activate()).status).toBe(500);
  await f.refresh();
  await f.confirm("committed");
  expect((await f.activate({ aeatCert: { synthetic: "changed" } })).status).toBe(409);
  expect(f.counts().applied).toBe(1);
  expect((await f.host.store.read())?.status).toBe("committed");
});
it.each(["committed", "complete"] as const)(
  "checks the actual commit after a failed %s host write",
  async (point) => {
    const f = await fixture();
    const update = f.host.store.update.bind(f.host.store);
    let failed = false;
    vi.spyOn(f.host.store, "update").mockImplementation(async (...args) => {
      if (!failed && args[2].kind === point) {
        failed = true;
        throw new Error(`before ${point} file`);
      }
      return update(...args);
    });
    await f.confirm();
    expect((await f.activate()).status).toBe(500);
    expect(failed).toBe(true);
    expect(await f.db.select().from(fiscalAllocations)).toHaveLength(1);
    await f.refresh();
    await f.confirm("committed");
    expect((await f.activate()).status).toBe(200);
    expect(f.counts().applied).toBe(1);
    expect((await f.host.store.read())?.status).toBe("complete");
  },
);

it("repairs a module-config write lost after commit without another activation", async () => {
  const f = await fixture();
  const configuration = await import("./module-config.js");
  vi.spyOn(configuration, "writeModuleConfig").mockRejectedValueOnce(
    new Error("module-config write failed"),
  );
  await f.confirm();
  expect((await f.activate()).status).toBe(500);
  await expect(readFile(join(f.stateDir, "modules.json"))).rejects.toMatchObject({
    code: "ENOENT",
  });
  expect(await f.db.select().from(fiscalAllocations)).toHaveLength(1);
  await f.refresh();
  await f.confirm("committed");
  expect((await f.activate()).status).toBe(200);
  expect(f.counts().applied).toBe(1);
  const { enabledModules } = await import("@waitron/module");
  const config = await configuration.readModuleConfig(f.stateDir);
  expect(
    enabledModules(ALL_MODULES, config)
      .filter((module) => module.fiscal !== undefined)
      .map((module) => module.fiscal!.id),
  ).toEqual(["verifactu"]);
});
it("accepts the wizard's exact attempt/revision reference and refuses an edited one", async () => {
  const f = await fixture();
  await f.confirm();
  const state = (await f.host.store.read())!;
  expect(
    (
      await f.activate({
        firstSetup: { attemptId: state.frozen.attemptId, revision: state.revision + 1 },
      })
    ).status,
  ).toBe(403);
  expect(f.counts().applied).toBe(0);
  expect(
    (
      await f.activate({
        firstSetup: { attemptId: state.frozen.attemptId, revision: state.revision },
      })
    ).status,
  ).toBe(200);
  expect(f.counts().applied).toBe(1);
});
it("retires an attempt whose saved committed result no longer matches the actual module result", async () => {
  const f = await fixture("publication");
  await f.confirm();
  expect((await f.activate()).status).toBe(500);
  const path = join(f.stateDir, "first-setup.json"),
    disk = JSON.parse(await readFile(path, "utf8"));
  disk.result.modules[MODULE].sifId = "wrong-sif";
  await writeFile(path, JSON.stringify(disk));
  await f.refresh();
  const reconfirm = await f.post(
    "/setup-api/first-setup/reconfirm",
    { password: PASSWORD, purpose: "activation" },
    f.headers(),
  );
  expect(reconfirm.status).toBe(200);
  const result = await f.post(
    "/setup-api/first-setup/current-master",
    {
      module: MODULE,
      statement: { ...f.current, priorActivation: "committed" },
      ...(await reconfirm.json()),
    },
    f.headers(),
  );
  expect(result.status).toBe(409);
  expect((await f.host.store.read())?.status).toBe("uncertain");
  expect(f.counts().applied).toBe(1);
});
