import { generateKeyPairSync, randomUUID, sign, createHash } from "node:crypto";
import { expect } from "vitest";
import { cloudFixture } from "./cloud-fixture.js";
import { createCloudConnection } from "../src/cloud-client.js";
export async function installationFixture(capture?: Parameters<typeof cloudFixture>[0]) {
  const issuer = generateKeyPairSync("ed25519");
  const keyId = createHash("sha256")
    .update(issuer.publicKey.export({ type: "spki", format: "der" }))
    .digest("base64url");
  const requests: unknown[][] = [];
  const replies = new Map<string, unknown>();
  let lose = false,
    offline = false,
    revoked = false,
    patch: Record<string, unknown> = {},
    delay = async () => {},
    failure = "";
  const f = await cloudFixture(async (values, saved, req, res) => {
    requests.push(values);
    if (String(values[2]).startsWith("backup-") && capture) {
      await capture(values, saved, req, res);
      return;
    }
    expect(req.url).toBe(`/api/installations/${values[2]}`);
    const lifecycle = saved.lifecycle as { pending: { operationId: string } };
    expect(lifecycle.pending.operationId).toBe(values[4]);
    await delay();
    if (offline) {
      res.writeHead(503);
      res.end("{}");
      return;
    }
    if (failure) {
      res.writeHead(401);
      res.end(JSON.stringify({ error: failure }));
      return;
    }
    const operation = String(values[4]);
    if (revoked && !(values[2] === "revoke" && replies.has(operation))) {
      res.writeHead(403);
      res.end('{"error":"revoked"}');
      return;
    }
    if (!replies.has(operation)) {
      const view = (saved.view as { registration: Record<string, string> }).registration;
      const now = Date.now();
      const leaseBytes = Buffer.from(
        JSON.stringify([
          "waitron-cloud-access-v1",
          values[1],
          keyId,
          randomUUID(),
          view.installationId,
          view.venueId,
          "test",
          saved.publicKey,
          now,
          now + 3600000,
          "control",
        ]),
      );
      const lease = {
        payload: leaseBytes.toString("base64url"),
        signature: sign(null, leaseBytes, issuer.privateKey).toString("base64url"),
      };
      if (values[2] === "revoke") revoked = true;
      replies.set(operation, {
        ...view,
        environment: "test",
        revision: 0,
        revokedAt: revoked ? new Date().toISOString() : null,
        lastContactAt: new Date().toISOString(),
        leaseExpiresAt: new Date(now + 3600000).toISOString(),
        services: ["continuous_backup", "remote_access", "retained_snapshots"].map((service) => ({
          service,
          state: "unconfigured",
          configuration: { secret: "adapter-only" },
          health: "unknown",
          failure: null,
          observedAt: null,
        })),
        ...(values[2] === "renew" ? { lease } : {}),
      });
    }
    if (lose) {
      lose = false;
      req.socket.destroy();
      return;
    }
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ ...(replies.get(operation) as object), ...patch }));
  });
  const client = createCloudConnection(f.options);
  await client.start();
  f.approve();
  const approved = await client.check();
  await client.complete(
    {
      requestId: approved.requestId!,
      organisationId: f.organisationId,
      legalBusinessId: f.legalBusinessId,
    },
    async () => {},
  );
  return {
    ...f,
    client,
    requests,
    replies,
    lose: () => {
      lose = true;
    },
    offline: () => {
      offline = true;
    },
    online: () => {
      offline = false;
    },
    revoke: () => {
      revoked = true;
    },
    patch: (v: Record<string, unknown>) => {
      patch = v;
    },
    delay: (fn: () => Promise<void>) => {
      delay = fn;
    },
    fail: (code: string) => {
      failure = code;
    },
  };
}
