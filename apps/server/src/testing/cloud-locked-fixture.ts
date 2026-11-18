import { generateKeyPairSync, randomUUID, sign, verify } from "node:crypto";
import { createServer } from "node:https";
import { Agent } from "undici";
import { vi } from "vitest";
import { mintMtlsMaterial } from "@waitron/server-kit/testing/mtls.js";
import type { CloudInstallationCredentials } from "../cloud-client.js";
import type { EmergencyCopyBinding } from "../emergency-copy-binding.js";
import { retainHttpListener } from "./retained-http-listener.js";

const material = mintMtlsMaterial();

export function lockedCopyStatusReply(binding: EmergencyCopyBinding, asOf: string) {
  return {
    version: 1,
    installationId: binding.installationId,
    venueId: binding.venueId,
    environment: binding.environment,
    sourceInstallationId: binding.sourceInstallationId,
    sourceNodeId: binding.sourceNodeId,
    copyNodeId: binding.copyNodeId,
    copyOperationId: binding.copyOperationId,
    startedAt: binding.startedAt,
    expiresAt: binding.expiresAt,
    asOf,
    eligibility: { status: "ready", open: true, closedReason: null },
    sourceLastHeardAt: null,
  };
}

export async function lockedCloudFixture(binding: EmergencyCopyBinding) {
  const issuer = generateKeyPairSync("ed25519");
  const machine = generateKeyPairSync("ed25519");
  let expiry = Date.parse(binding.expiresAt),
    status = 200;
  let delay = async () => {};
  const requests: unknown[][] = [];
  const proofs: boolean[] = [];
  const registration = {
    venueId: binding.venueId,
    installationId: binding.installationId,
    organisationId: randomUUID(),
    legalBusinessId: randomUUID(),
  };
  const server = createServer(
    { key: material.serverKeyPem, cert: material.serverCertPem },
    async (req, res) => {
      let body = "";
      for await (const chunk of req) body += String(chunk);
      const envelope = JSON.parse(body);
      const bytes = Buffer.from(envelope.payload, "base64url");
      const values = JSON.parse(bytes.toString());
      requests.push(values);
      proofs.push(
        verify(null, bytes, machine.publicKey, Buffer.from(envelope.signature, "base64url")),
      );
      await delay();
      if (status !== 200) {
        res.writeHead(status);
        res.end(JSON.stringify({ error: status === 403 ? "revoked" : "unavailable" }));
        return;
      }
      if (req.url === "/api/installations/emergency-copy-status") {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify(lockedCopyStatusReply(binding, new Date().toISOString())));
        return;
      }
      const leaseBytes = Buffer.from(
        JSON.stringify([
          "waitron-cloud-access-v1",
          state.origin,
          "a".repeat(43),
          randomUUID(),
          registration.installationId,
          registration.venueId,
          state.environment,
          state.publicKey,
          Date.now(),
          expiry,
          "control",
        ]),
      );
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          ...registration,
          environment: state.environment,
          revision: 0,
          revokedAt: null,
          lastContactAt: new Date().toISOString(),
          leaseExpiresAt: new Date(expiry).toISOString(),
          services: ["continuous_backup", "remote_access", "retained_snapshots"].map((service) => ({
            service,
            state: "unconfigured",
            health: "unknown",
            failure: null,
            configuration: {},
            observedAt: null,
          })),
          lease: {
            payload: leaseBytes.toString("base64url"),
            signature: sign(null, leaseBytes, issuer.privateKey).toString("base64url"),
          },
        }),
      );
    },
  );
  const listener = await retainHttpListener("127.0.0.1", server);
  const agent = new Agent({ connect: { ca: material.caPem } });
  const realFetch = globalThis.fetch;
  const fetchSpy = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation((input, init) =>
      realFetch(input, { ...init, dispatcher: agent } as RequestInit),
    );
  const state: CloudInstallationCredentials = {
    origin: `https://127.0.0.1:${listener.port}`,
    publicKey: machine.publicKey.export({ format: "der", type: "spki" }).toString("base64url"),
    privateKey: machine.privateKey.export({ format: "der", type: "pkcs8" }).toString("base64url"),
    environment: "test",
    view: { registration },
  };
  return {
    state,
    requests,
    proofs,
    material,
    fetches: () => fetchSpy.mock.calls.length,
    delay: (fn: () => Promise<void>) => {
      delay = fn;
    },
    expireAt: (value: number) => {
      expiry = value;
    },
    refuse: (value: number) => {
      status = value;
    },
    async close() {
      fetchSpy.mockRestore();
      await agent.close();
      await listener.close();
    },
  };
}
