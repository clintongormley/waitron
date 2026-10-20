import { Socket } from "node:net";
import { TLSSocket } from "node:tls";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Hono } from "hono";
import { afterEach, expect, it } from "vitest";
import { verifySecretAsync } from "@waitron/identity";
import { declaredFirstFiscalFixture } from "../test/declared-first-fiscal.js";
import { createFirstSetupModuleHost } from "./module-operation-host.js";
import { mountSetup } from "./setup-api.js";

const fixtures: Awaited<ReturnType<typeof declaredFirstFiscalFixture>>[] = [];
const sockets: TLSSocket[] = [];
afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.destroy();
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
  const staged = await host.keys.stageInitialNodeKey(
    f.ownerAttempt,
    await host.owner.reconfirm(f.ownerAttempt, f.password, "block-use"),
  );
  const app = new Hono();
  mountSetup(app, { environment: "production", firstFiscal: host }, () => {});
  const headers = {
    "Content-Type": "application/json",
    "X-Waitron-Setup-Owner": f.ownerAttempt.capability,
    "X-Waitron-Setup-Attempt": f.ownerAttempt.attemptId,
    "X-Waitron-Setup-Revision": String(f.ownerAttempt.revision),
    "X-Waitron-Setup-Generation": String(f.ownerAttempt.ownerGeneration),
  };
  const post = (
    body: unknown = { password: f.password },
    extra: Record<string, string> = {},
    encrypted = true,
  ) => {
    const socket = encrypted ? new TLSSocket(new Socket()) : undefined;
    if (socket) sockets.push(socket);
    return app.request(
      "https://box.test/setup-api/first-setup/node-key-reissue",
      {
        method: "POST",
        headers: { ...headers, ...extra },
        body: JSON.stringify(body),
      },
      socket ? { incoming: { socket } } : undefined,
    );
  };
  return { ...f, host, staged, post, keyPath: join(f.stateDir, "first-setup-node-key.json") };
}
it("reissues through the authenticated setup route while retaining the same frozen hour and attempt", async () => {
  const f = await fixture();
  const state = await f.host.store.read();
  const response = await f.post();
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  const result = await response.json();
  const stage = await f.host.keys.readStage(f.ownerAttempt);
  expect(result).toEqual({
    stage: { stageId: stage.stageId, nodeId: stage.nodeId, name: stage.name },
    key: { nodeId: stage.nodeId, name: stage.name, secret: expect.any(String) },
  });
  expect(stage.stageId).not.toBe(f.staged.stage.stageId);
  expect(await verifySecretAsync(result.key.secret, stage.verifier)).toBe(true);
  expect(await verifySecretAsync(f.staged.key.secret, stage.verifier)).toBe(false);
  expect(await f.host.store.read()).toEqual(state);
  expect(JSON.stringify(result)).not.toContain("scrypt$");
  expect(await readFile(f.keyPath, "utf8")).not.toContain(result.key.secret);
});
it.each([
  "plain HTTP",
  "forwarded HTTPS",
  "foreign origin",
  "cross-site",
  "stranger",
  "stale owner",
  "wrong password",
])("refuses %s without replacing the retained verifier", async (fault) => {
  const f = await fixture();
  const before = await readFile(f.keyPath);
  const state = await f.host.store.read();
  const extra: Record<string, string> =
    fault === "forwarded HTTPS"
      ? { "X-Forwarded-Proto": "https" }
      : fault === "foreign origin"
        ? { Origin: "https://attacker.test" }
        : fault === "cross-site"
          ? { "Sec-Fetch-Site": "cross-site" }
          : fault === "stranger"
            ? { "X-Waitron-Setup-Owner": "x".repeat(43) }
            : fault === "stale owner"
              ? { "X-Waitron-Setup-Revision": "99" }
              : {};
  const response = await f.post(
    { password: fault === "wrong password" ? "wrong password" : f.password },
    extra,
    !["plain HTTP", "forwarded HTTPS"].includes(fault),
  );
  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({ error: { code: "setup.owner_required", params: {} } });
  expect(await readFile(f.keyPath)).toEqual(before);
  expect(await f.host.store.read()).toEqual(state);
});
it.each([
  {},
  { password: null },
  { password: [] },
  { password: "" },
  { password: "x", extra: true },
])("refuses malformed reissue %j without replacing a verifier", async (body) => {
  const f = await fixture();
  const before = await readFile(f.keyPath);
  const response = await f.post(body);
  expect(response.status).toBe(400);
  expect((await response.json()).error.code).toBe("setup.request_invalid");
  expect(await readFile(f.keyPath)).toEqual(before);
});
