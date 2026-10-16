import { Hono } from "hono";
import { declaredFirstFiscalFixture, publicDigest } from "../test/declared-first-fiscal.js";
import { createFirstSetupModuleHost } from "./module-operation-host.js";
import { mountSetup } from "./setup-api.js";
const fixtures: Awaited<ReturnType<typeof declaredFirstFiscalFixture>>[] = [];
afterEach(async () => {
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
it("delivers one transient node key and accepts an explicit matching kept document", async () => {
  const f = await fixture();
  const reconfirmation = await f.host.owner.reconfirm(f.ownerAttempt, f.password, "block-use");
  const response = await f.post("node-key", { reconfirmation });
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
    historyDigest: f.statement.delivery.historyDigest,
    documentDigest: f.statement.delivery.documentDigest,
  };
  const registered = await f.post("document", { ...reference, statement: f.statement });
  expect(registered.status).toBe(200);
  await expect(f.host.evidence.read(f.context.binding)).rejects.toMatchObject({
    code: "sif.allocation_invalid",
  });
  const kept = await f.post("document-kept", {
    ...reference,
    kept: true,
    reconfirmation: await f.host.owner.reconfirm(f.ownerAttempt, f.password, "activation"),
  });
  expect(kept.status).toBe(200);
  expect(await f.host.evidence.read(f.context.binding)).toEqual({
    trust: null,
    current: f.statement,
  });
});
it.each(["node-key", "document", "document-kept"])(
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
