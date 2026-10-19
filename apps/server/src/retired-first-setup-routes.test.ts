import { createHash, generateKeyPairSync, randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { ALL_MODULES } from "@waitron/composition";
import { request, PASSWORD } from "../test/first-fiscal.js";
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
    const claimed = await host.owner.claimFirstSetup(
      { environment: "production", request },
      randomBytes(32).toString("base64url"),
    );
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
