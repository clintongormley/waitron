import { createHash, generateKeyPairSync } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TLSSocket } from "node:tls";
import { afterEach, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { ALL_MODULES } from "@waitron/composition";
import { firstFiscalFixture, request, PASSWORD } from "../test/first-fiscal.js";
import { resolveFirstSetupEntry } from "./first-setup-entry.js";
import { createFirstSetupModuleHost } from "./module-operation-host.js";
import { mountSetup } from "./setup-api.js";

const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it.each(["cloud", "serials"] as const)(
  "the owned HTTP setup route refuses retired %s selection with a configured Cloud issuer",
  async (route) => {
    const root = await mkdtemp(join(tmpdir(), "retired-setup-route-"));
    roots.push(root);
    const keys = generateKeyPairSync("ed25519");
    const publicKey = keys.publicKey.export({ type: "spki", format: "der" });
    const keyId = createHash("sha256").update(publicKey).digest("hex");
    const issuerPath = join(root, "issuer.json");
    await writeFile(
      issuerPath,
      JSON.stringify({
        issuer: "fixture-registry",
        fingerprint: keyId,
        publicKey: publicKey.toString("base64url"),
      }),
    );
    const host = createFirstSetupModuleHost({
      modules: ALL_MODULES,
      environment: {
        WAITRON_FISCAL_CLOUD_TRUST_FILE: issuerPath,
        WAITRON_FISCAL_CLOUD_FINGERPRINT: keyId,
        WAITRON_FISCAL_CLOUD_RECEIPT_DIRECTORY: root,
      },
      stateDir: join(root, "state"),
      venueDir: join(root, "venue"),
    });
    const claimed = await host.owner.claimFirstSetup({ environment: "production", request });
    const owner = {
      attemptId: claimed.state.attemptId,
      revision: claimed.state.revision,
      ownerGeneration: claimed.state.ownerGeneration,
      capability: claimed.capability,
    };
    const app = new Hono();
    mountSetup(app, { environment: "production", firstFiscal: host }, () => {});
    const before = await host.store.read();
    const network = vi.fn(() => {
      throw new Error("retired setup selection contacted an outside service");
    });
    vi.stubGlobal("fetch", network);
    const response = await app.request("/setup-api/first-setup/candidates", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Waitron-Setup-Owner": owner.capability,
        "X-Waitron-Setup-Attempt": owner.attemptId,
        "X-Waitron-Setup-Revision": String(owner.revision),
        "X-Waitron-Setup-Generation": String(owner.ownerGeneration),
      },
      body: JSON.stringify({
        module: "fiscal-verifactu",
        proposal:
          route === "cloud"
            ? {
                route: "cloud",
                venueId: "10000000-0000-4000-8000-000000000002",
                operationId: "10000000-0000-4000-8000-000000000001",
                incidentEvidence: "outside/first-cloud",
              }
            : { serials: [1, 2] },
        reconfirmation: await host.owner.reconfirm(owner, PASSWORD, "block-use"),
      }),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "sif.allocation_invalid" } });
    expect(await host.store.read()).toEqual(before);
    expect(network).not.toHaveBeenCalled();
  },
);

it("the repair entry no longer serves Finish setup", async () => {
  const root = await mkdtemp(join(tmpdir(), "retired-finish-routes-"));
  roots.push(root);
  const stateDir = join(root, "state");
  const venueDir = join(root, "venue");
  await mkdir(stateDir);
  await mkdir(venueDir);
  await writeFile(join(stateDir, "first-setup.json"), "retained torn claim");
  const entry = await resolveFirstSetupEntry({ stateDir, venueDir }, {});
  if (entry.kind !== "resolution") throw new Error(`expected the repair entry, got ${entry.kind}`);
  const base = "/setup-api/first-setup/resolution";
  expect((await entry.app.request("/setup-api/first-setup/status")).status).toBe(200);
  expect((await entry.app.request(`${base}/publication`)).status).toBe(404);
  for (const action of ["reconfirm", "document", "document-kept", "finish"]) {
    const response = await entry.app.request(`${base}/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    expect([action, response.status]).toEqual([action, 404]);
  }
});

it("no route takes the setup password to win the setup back", async () => {
  const f = await firstFiscalFixture();
  const socket = new TLSSocket(new Socket());
  try {
    const https = { incoming: { socket } };
    const mounted = new Hono();
    const host = createFirstSetupModuleHost({
      stateDir: f.stateDir,
      venueDir: f.venueDir,
      environment: {},
      modules: f.modules,
    });
    mountSetup(mounted, { environment: "production", firstFiscal: host }, () => {});
    const entry = await resolveFirstSetupEntry({ stateDir: f.stateDir, venueDir: f.venueDir }, {});
    if (entry.kind !== "resolution")
      throw new Error(`expected the repair entry, got ${entry.kind}`);
    const inspection = await host.resolution.inspectFirstSetupResolution();
    const before = await readFile(join(f.stateDir, "first-setup.json"));
    const claim = {
      password: PASSWORD,
    };
    const routes = [
      ["/setup-api/first-setup/resume", claim],
      ["/setup-api/first-setup/recover", claim],
      [
        "/setup-api/first-setup/resolution/recover",
        {
          ...claim,
          inspectionId: inspection.inspectionId,
          revision: inspection.revision,
          ownerGeneration: inspection.ownerGeneration,
        },
      ],
    ] as const;
    for (const [name, app] of [
      ["mountSetup", mounted],
      ["repair entry", entry.app],
    ] as const)
      for (const [path, body] of routes) {
        const response = await app.request(
          `https://box.test${path}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          },
          https,
        );
        expect([name, path, response.status]).toEqual([name, path, 404]);
        expect(await readFile(join(f.stateDir, "first-setup.json"))).toEqual(before);
      }
  } finally {
    socket.destroy();
    await f.dispose();
  }
});
