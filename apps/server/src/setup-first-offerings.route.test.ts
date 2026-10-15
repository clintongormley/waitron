import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { Hono } from "hono";
import { ALL_MODULES } from "@waitron/composition";
import { createFirstSetupModuleHost } from "./module-operation-host.js";
import { mountSetup } from "./setup-api.js";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
async function fixture(disabled = false) {
  const root = await mkdtemp(join(tmpdir(), "first-offerings-"));
  dirs.push(root);
  const host = createFirstSetupModuleHost({
    environment: {},
    stateDir: join(root, "state"),
    venueDir: join(root, "venue"),
    modules: disabled
      ? ALL_MODULES.map((module) =>
          module.name === "fiscal-verifactu"
            ? { ...module, provisioning: { ...module.provisioning!, initialSetup: undefined } }
            : module,
        )
      : ALL_MODULES,
  });
  const app = new Hono();
  mountSetup(app, { environment: "production", firstFiscal: host }, () => {});
  const post = (body: unknown) =>
    app.request("/setup-api/first-setup/offerings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  return { host, post };
}
it("discovers the server-selected setup offerings without claiming an identity", async () => {
  const { host, post } = await fixture();
  const response = await post({ fiscalTerritory: "ES-common" });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    modules: [{ module: "fiscal-verifactu", version: "0.0.0" }],
  });
  expect(await host.store.read()).toBeNull();
});
it("does not invent an offering for fiscal-none or an installed module without the seat", async () => {
  const normal = await fixture();
  const none = await normal.post({ fiscalTerritory: "GB-vat" });
  expect(none.status).toBe(200);
  expect(await none.json()).toEqual({ modules: [] });
  const disabled = await fixture(true);
  const response = await disabled.post({ fiscalTerritory: "ES-common" });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ modules: [] });
});
it.each([{}, { fiscalTerritory: [] }, { fiscalTerritory: "ES-common", modules: ["fabricated"] }])(
  "rejects an invalid offering query without creating state: %j",
  async (body) => {
    const { post, host } = await fixture();
    const response = await post(body);
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("setup.request_invalid");
    expect(await host.store.read()).toBeNull();
  },
);

it("exposes the durable consumption distinction to the owner without publishing it to strangers", async () => {
  const { randomBytes } = await import("node:crypto");
  const { request } = await import("../test/first-fiscal.js");
  const { host } = await fixture();
  const claimed = await host.owner.claimFirstSetup(
    { environment: "production", request },
    randomBytes(32).toString("base64url"),
  );
  expect(claimed.state.consumptionIntent).toBe(false);
  await host.store.update(claimed.state.attemptId, 1, { kind: "consumption-intent" });
  const status = await host.owner.status({
    attemptId: claimed.state.attemptId,
    revision: 1,
    ownerGeneration: 1,
    capability: claimed.capability,
  });
  const { publicFirstSetupState } = await import("./first-setup-owner.js");
  expect(publicFirstSetupState(status).consumptionIntent).toBe(true);
});
