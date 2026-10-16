import { createHash, generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { ALL_MODULES } from "@waitron/composition";
import { request, PASSWORD } from "../test/first-fiscal.js";
import { cloudReceiptFixture } from "@waitron/fiscal-verifactu/test/cloud-fixture.js";
import { firstSetupModuleContext } from "./first-fiscal-evidence.js";
import { firstFiscalPublicDigest } from "./first-fiscal-delivery.js";
import { createFirstSetupModuleHost } from "./module-operation-host.js";
import { mountSetup } from "./setup-api.js";

const dirs: string[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});
const venueId = "10000000-0000-4000-8000-000000000002",
  operationId = "10000000-0000-4000-8000-000000000001";
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v !== null && typeof v === "object")
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  return JSON.stringify(v);
}
async function fixture(configured = true) {
  const root = await mkdtemp(join(tmpdir(), "cloud-first-route-"));
  dirs.push(root);
  const keys = generateKeyPairSync("ed25519"),
    publicKey = keys.publicKey.export({ type: "spki", format: "der" });
  const keyId = createHash("sha256").update(publicKey).digest("hex"),
    path = join(root, "issuer.json");
  await writeFile(
    path,
    JSON.stringify({
      issuer: "fixture-registry",
      fingerprint: keyId,
      publicKey: publicKey.toString("base64url"),
    }),
  );
  const host = createFirstSetupModuleHost({
    modules: ALL_MODULES,
    environment: configured
      ? {
          WAITRON_FISCAL_CLOUD_TRUST_FILE: path,
          WAITRON_FISCAL_CLOUD_FINGERPRINT: keyId,
          WAITRON_FISCAL_CLOUD_RECEIPT_DIRECTORY: root,
        }
      : {},
    stateDir: join(root, "state"),
    venueDir: join(root, "venue"),
  });
  const nonce = randomBytes(32).toString("base64url");
  const claimed = await host.owner.claimFirstSetup({ environment: "production", request }, nonce);
  let owner = {
    attemptId: claimed.state.attemptId,
    revision: claimed.state.revision,
    ownerGeneration: claimed.state.ownerGeneration,
    capability: claimed.capability,
  };
  const app = new Hono();
  mountSetup(app, { environment: "production", firstFiscal: host }, () => {});
  const headers = () => ({
    "Content-Type": "application/json",
    "X-Waitron-Setup-Owner": owner.capability,
    "X-Waitron-Setup-Attempt": owner.attemptId,
    "X-Waitron-Setup-Revision": String(owner.revision),
    "X-Waitron-Setup-Generation": String(owner.ownerGeneration),
  });
  const post = async (action: string, body: unknown, extra: Record<string, string> = {}) => {
    const response = await app.request(`/setup-api/first-setup/${action}`, {
      method: "POST",
      headers: { ...headers(), ...extra },
      body: JSON.stringify(body),
    });
    return response;
  };
  const selected = await post("candidates", {
    module: "fiscal-verifactu",
    proposal: { route: "cloud", venueId, operationId, incidentEvidence: "outside/first-cloud" },
    reconfirmation: await host.owner.reconfirm(owner, PASSWORD, "block-use"),
  });
  expect(selected.status).toBe(200);
  const state = await host.store.read();
  owner = { ...owner, revision: state!.revision };
  const context = firstSetupModuleContext(state!, "fiscal-verifactu");
  const f = cloudReceiptFixture((p) => {
    Object.assign(p, { mode: "initial-setup", venueId });
    Object.assign(p.binding, {
      eventId: context.binding.eventId,
      sourceId: context.binding.sourceId,
      targetNodeId: context.binding.targetNodeId,
      operatorId: context.administratorId,
      incidentEvidence: "outside/first-cloud",
    });
    Object.assign(p.approval!, p.binding, { oldMachineAbsent: true, oldMachineOffline: false });
    Object.assign(p.allocation, {
      taxpayerNif: context.taxId,
      softwareId: "W1",
      environment: "production",
    });
    Object.assign(p.continuity.scope, {
      taxpayerNif: context.taxId,
      softwareId: "W1",
      environment: "production",
    });
  });
  const receipt = {
    payload: f.receipt.payload,
    keyId,
    signature: sign(
      null,
      Buffer.from(canonical(["waitron.fiscal-allocation-receipt", 1, keyId, f.receipt.payload])),
      keys.privateKey,
    ).toString("base64url"),
  };
  const packet =
    "WAITRON-FISCAL-ALLOCATION-1:" + Buffer.from(canonical(receipt)).toString("base64url");
  const input = {
    allocation: receipt.payload.allocation,
    approval: receipt.payload.approval,
    receipt: packet,
  };
  return {
    root,
    path,
    app,
    host,
    post,
    context,
    input,
    receipt,
    owner: () => owner,
    nonce,
    getRequest: () => app.request("/setup-api/first-setup/request", { headers: headers() }),
    refresh: async () => {
      owner = { ...owner, revision: (await host.store.read())!.revision };
    },
  };
}
it("imports the exact consumed C packet and grants only an owner-confirmed kept document, with zero paper transport", async () => {
  const fetch = vi.fn(() => {
    throw new Error("no outside call belongs in receipt import");
  });
  vi.stubGlobal("fetch", fetch);
  const f = await fixture();
  const imported = await f.post("input", { module: "fiscal-verifactu", input: f.input });
  expect(imported.status).toBe(200);
  await f.refresh();
  const stagedResponse = await f.post("node-key", {
    reconfirmation: await f.host.owner.reconfirm(f.owner(), PASSWORD, "block-use"),
  });
  expect(stagedResponse.status).toBe(200);
  const staged = await stagedResponse.json();
  const statement = {
    version: 1,
    kind: "cloud-initial-confirmation",
    binding: f.context.binding,
    operatorId: f.context.administratorId,
    allocationId: f.input.allocation.allocationId,
    receiptId: f.receipt.payload.receiptId,
    priorActivation: "none",
    incidentEvidence: "outside/first-cloud",
    requiredBases: f.context.bases,
    delivery: {
      kept: true,
      documentDigest: "a".repeat(64),
      historyDigest: createHash("sha256").update(f.input.receipt).digest("hex"),
    },
  };
  const reference = {
    module: "fiscal-verifactu",
    stageId: staged.stage.stageId,
    inputDigest: firstFiscalPublicDigest(f.input),
    documentDigest: "a".repeat(64),
    historyDigest: createHash("sha256").update(f.input.receipt).digest("hex"),
  };
  expect((await f.post("document", { ...reference, statement })).status).toBe(200);
  await expect(f.host.evidence.read(f.context.binding)).rejects.toMatchObject({
    code: "sif.allocation_invalid",
  });
  expect(
    (
      await f.post("document-kept", {
        ...reference,
        kept: true,
        reconfirmation: await f.host.owner.reconfirm(f.owner(), PASSWORD, "activation"),
      })
    ).status,
  ).toBe(200);
  expect(await f.host.evidence.read(f.context.binding)).toEqual({
    trust: null,
    current: statement,
  });
  await expect(f.host.evidence.read(f.context.binding)).rejects.toMatchObject({
    code: "sif.allocation_invalid",
  });
  expect((await f.host.store.read())!.inputs["fiscal-verifactu"]).toEqual(f.input);
  expect(fetch).not.toHaveBeenCalled();
});
it("does not let uploaded Cloud trust enable an unconfigured issuer", async () => {
  const f = await fixture(false);
  const response = await f.post("input", { module: "fiscal-verifactu", input: f.input });
  expect(response.status).toBe(400);
  expect((await response.json()).error.code).toBe("sif.allocation_invalid");
  expect((await f.host.store.read())!.inputs).toEqual({});
});
it.each(["stranger", "foreign-origin"])(
  "refuses a %s before importing the consumed packet",
  async (kind) => {
    const f = await fixture();
    const before = await f.host.store.read();
    const response = await f.post(
      "input",
      { module: "fiscal-verifactu", input: f.input },
      kind === "stranger"
        ? { "X-Waitron-Setup-Owner": "x".repeat(43) }
        : { Origin: "https://foreign.example" },
    );
    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe("setup.owner_required");
    expect((await f.host.store.read())!.inputs).toEqual({});
    expect(await f.host.store.read()).toEqual(before);
  },
);

it("retains the original Cloud reserve operation across repeated request exports and owner rebind", async () => {
  const f = await fixture();
  const first = await f.getRequest();
  expect(first.status).toBe(200);
  const exported = await first.json();
  expect(
    exported.modules.find((m: { module: string }) => m.module === "fiscal-verifactu").request
      .operationId,
  ).toBe(operationId);
  expect(await (await f.getRequest()).json()).toEqual(exported);
  await f.host.owner.resumeFirstSetup(f.nonce, { password: PASSWORD });
  const rebound = await f.host.store.read();
  expect(rebound!.frozen.modules.find((m) => m.module === "fiscal-verifactu")!.request).toEqual(
    exported.modules.find((m: { module: string }) => m.module === "fiscal-verifactu").request,
  );
  expect(rebound!.status).toBe("consumption-intent");
});
