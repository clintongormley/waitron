import { expect, it, vi } from "vitest";
import { DashboardApi } from "./client.js";

it("posts the node credential and public register in the request body, never in a URL", async () => {
  const pack = {
    version: 1,
    kind: "node-recovery-pack",
    createdAt: "2026-10-14T10:00:00.000Z",
    nodeRecovery: { nodeId: "node-one", name: "K7QF", secret: "private-node-key" },
    modules: { "test-regime": { signed: "public" } },
    warnings: [
      "contains-node-recovery-key",
      "register-snapshot-may-be-stale",
      "retain-older-node-keys-for-older-backups",
    ],
  };
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(pack)));
  const api = new DashboardApi("", fetcher);
  expect(
    await api.createNodeRecoveryPack("private-node-key", { "test-regime": { signed: "public" } }),
  ).toEqual(pack);
  expect(fetcher).toHaveBeenCalledWith(
    "/api/box/recovery-pack",
    expect.objectContaining({
      method: "POST",
      credentials: "include",
      body: JSON.stringify({
        nodeRecoveryKey: "private-node-key",
        modules: { "test-regime": { signed: "public" } },
      }),
    }),
  );
});
