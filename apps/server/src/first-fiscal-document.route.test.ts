import { Hono } from "hono";
import { vi } from "vitest";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { TEST_MIGRATIONS } from "@waitron/fiscal-verifactu/test/migrations.js";
import { hourFirstFiscalFixture } from "../test/hour-first-fiscal.js";
import { declaredFirstFiscalFixture, publicDigest } from "../test/declared-first-fiscal.js";
import { createFirstSetupModuleHost } from "./module-operation-host.js";
import { mountSetup } from "./setup-api.js";
vi.mock("@waitron/fiscal-verifactu/src/hour-clock-internet.js", () => ({
  observeInternetHourClock: async () => {
    const now = Date.now(),
      mono = performance.now();
    return {
      source: "internet",
      result: "usable",
      instantMs: now,
      uncertaintyMs: 500,
      wallStartedMs: now,
      wallFinishedMs: now,
      monotonicStartedMs: mono,
      monotonicFinishedMs: mono,
    };
  },
}));
vi.mock("@waitron/fiscal-verifactu/src/hour-release.js", () => ({
  readHourRelease: () => ({ instantMs: Date.parse("2026-10-15T00:00:00Z") }),
}));
const fixtures: { dispose(): Promise<void> }[] = [];
afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(fixtures.splice(0).map((f) => f.dispose()));
});
async function fixture() {
  const f = await declaredFirstFiscalFixture();
  fixtures.push(f);
  const host = createFirstSetupModuleHost({
    environment: {},
    stateDir: f.stateDir,
    venueDir: f.venueDir,
    modules: f.modules,
  });
  const app = new Hono();
  mountSetup(app, { environment: "production", firstFiscal: host }, () => {});
  const headers = {
    "X-Waitron-Setup-Owner": f.ownerAttempt.capability,
    "X-Waitron-Setup-Attempt": f.ownerAttempt.attemptId,
    "X-Waitron-Setup-Revision": String(f.ownerAttempt.revision),
    "X-Waitron-Setup-Generation": String(f.ownerAttempt.ownerGeneration),
  };
  const post = (action: string, body: unknown, extra: Record<string, string> = {}) =>
    app.request(`/setup-api/first-setup/${action}`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json", ...extra },
      body: JSON.stringify(body),
    });
  return { ...f, host, app, post };
}
describe("hour recovery document route", () => {
  const venue = useVenueDb({ migrations: TEST_MIGRATIONS });
  it("delivers one transient node key and accepts an explicit matching kept document", async () => {
    vi.useFakeTimers({ toFake: ["Date", "performance"] });
    vi.setSystemTime("2026-10-16T11:40:00Z");
    const f = await hourFirstFiscalFixture({ database: () => venue.db });
    fixtures.push(f);
    const app = new Hono();
    mountSetup(app, { environment: "production", firstFiscal: f.host }, () => {});
    const post = (action: string, body: unknown) =>
      app.request(`/setup-api/first-setup/${action}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Waitron-Setup-Owner": f.ownerAttempt.capability,
          "X-Waitron-Setup-Attempt": f.ownerAttempt.attemptId,
          "X-Waitron-Setup-Revision": String(f.ownerAttempt.revision),
          "X-Waitron-Setup-Generation": String(f.ownerAttempt.ownerGeneration),
        },
        body: JSON.stringify(body),
      });
    const reconfirmation = await f.host.owner.reconfirm(f.ownerAttempt, f.password, "block-use");
    const response = await post("node-key", { reconfirmation });
    expect(response.status).toBe(200);
    const staged = await response.json();
    expect(staged.key.nodeId).toBe(f.context.binding.targetNodeId);
    expect(staged.key.secret).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(staged.stage).toEqual({
      stageId: expect.any(String),
      nodeId: f.context.binding.targetNodeId,
      name: staged.key.name,
    });
    expect(JSON.stringify(staged)).not.toContain("scrypt$");
    const reference = {
      module: f.module,
      stageId: staged.stage.stageId,
      inputDigest: publicDigest(f.input),
      bindingDigest: publicDigest(f.staged.statement),
      documentDigest: f.staged.ref.documentDigest,
    };
    const registered = await post("recovery-document", {
      ...reference,
      statement: f.staged.statement,
    });
    expect(registered.status).toBe(200);
    expect(await f.host.recoveryDelivery.readRecoveryDocument(f.ownerAttempt, f.module)).toEqual({
      ...reference,
      statement: f.staged.statement,
    });
    await expect(f.host.recoveryDelivery.consume(f.ownerAttempt, f.module)).rejects.toMatchObject({
      code: "setup.not_ready",
      params: {},
    });
    const mismatch = await post("recovery-document-kept", {
      ...reference,
      documentDigest: "b".repeat(64),
      kept: true,
      reconfirmation: await f.host.owner.reconfirm(f.ownerAttempt, f.password, "activation"),
    });
    expect(mismatch.status).toBe(503);
    expect((await mismatch.json()).error).toEqual({ code: "setup.not_ready", params: {} });
    await expect(f.host.recoveryDelivery.consume(f.ownerAttempt, f.module)).rejects.toMatchObject({
      code: "setup.not_ready",
      params: {},
    });
    const kept = await post("recovery-document-kept", {
      ...reference,
      kept: true,
      reconfirmation: await f.host.owner.reconfirm(f.ownerAttempt, f.password, "activation"),
    });
    expect(kept.status).toBe(200);
    await expect(
      f.host.recoveryDelivery.consume(f.ownerAttempt, f.module),
    ).resolves.toBeUndefined();
    await expect(f.host.recoveryDelivery.consume(f.ownerAttempt, f.module)).rejects.toMatchObject({
      code: "setup.not_ready",
      params: {},
    });
  });
});
it.each(["node-key", "document", "document-kept", "recovery-document", "recovery-document-kept"])(
  "refuses a stranger and a foreign origin on %s",
  async (action) => {
    const f = await fixture();
    for (const extra of [
      { "X-Waitron-Setup-Owner": "x".repeat(43) },
      { Origin: "https://other.example" },
    ] as Record<string, string>[]) {
      const response = await f.post(action, {}, extra);
      expect(response.status).toBe(403);
      expect((await response.json()).error.code).toBe("setup.owner_required");
    }
  },
);
it("keeps the ordinary setup body limit when a document upload has its own bound", async () => {
  const f = await fixture();
  const response = await f.post("node-key", { reconfirmation: "x".repeat(131073) });
  expect(response.status).toBe(400);
  expect((await response.json()).error.code).toBe("setup.request_invalid");
});
