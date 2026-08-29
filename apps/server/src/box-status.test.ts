import { describe, expect, it } from "vitest";
import { collectBoxStatus, type BoxStatusReaders } from "./box-status.js";

const base: BoxStatusReaders = {
  mode: async () => "primary",
  singletonRole: async () => "primary",
  environment: "preproduction",
  time: async () => ({ synced: true, source: "timedatectl", warn: false }),
  cert: () => Promise.resolve({ notAfter: "2030-01-01T00:00:00.000Z", daysRemaining: 30 }),
  chain: async () => ({ height: 7, lastAt: "2026-08-29T10:00:00.000Z" }),
  replicationLag: undefined,
  duties: () => ({ "fiscal.drain": { stale: false } }),
};

describe("collectBoxStatus", () => {
  it("composes every field with cert available and replication/backup N-A", async () => {
    const status = await collectBoxStatus(base);
    expect(status).toEqual({
      mode: "primary",
      singletonRole: "primary",
      environment: "preproduction",
      time: { synced: true, source: "timedatectl", warn: false },
      cert: { available: true, notAfter: "2030-01-01T00:00:00.000Z", daysRemaining: 30 },
      chain: { height: 7, lastAt: "2026-08-29T10:00:00.000Z" },
      replication: { configured: false },
      backup: { configured: false },
      duties: { "fiscal.drain": { stale: false } },
    });
  });

  it("passes singletonRole through from its reader", async () => {
    const status = await collectBoxStatus({ ...base, singletonRole: async () => "secondary" });
    expect(status.singletonRole).toBe("secondary");
  });

  it("reports cert unavailable when no cert reader is configured", async () => {
    const status = await collectBoxStatus({ ...base, cert: undefined });
    expect(status.cert).toEqual({ available: false });
  });

  it("reports cert unavailable when the cert read throws (e.g. missing file)", async () => {
    const status = await collectBoxStatus({
      ...base,
      cert: () => Promise.reject(new Error("ENOENT")),
    });
    expect(status.cert).toEqual({ available: false });
  });

  it("summarises replication lag worst-first when a lag reader is present", async () => {
    const status = await collectBoxStatus({
      ...base,
      replicationLag: async () => [
        { subscriberId: "s1", originId: "o1", lag: 42n, alive: true },
        { subscriberId: "s2", originId: "o1", lag: 3n, alive: true },
      ],
    });
    expect(status.replication).toEqual({ configured: true, worstLagSeq: "42", subscribers: 2 });
  });

  it("reports zero worst-lag when the lag reader returns no subscribers", async () => {
    const status = await collectBoxStatus({ ...base, replicationLag: async () => [] });
    expect(status.replication).toEqual({ configured: true, worstLagSeq: "0", subscribers: 0 });
  });

  it("propagates a replicationLag reader fault (fail-loud, no configured:false fallback)", async () => {
    await expect(
      collectBoxStatus({
        ...base,
        replicationLag: () => Promise.reject(new Error("lag read failed")),
      }),
    ).rejects.toThrow("lag read failed");
  });

  it("passes a configured backup summary through from its reader", async () => {
    const status = await collectBoxStatus({
      ...base,
      backup: async () => ({
        configured: true,
        lastBackupAt: "2026-08-29T09:00:00.000Z",
        ageSeconds: 3600,
        stale: false,
      }),
    });
    expect(status.backup).toEqual({
      configured: true,
      lastBackupAt: "2026-08-29T09:00:00.000Z",
      ageSeconds: 3600,
      stale: false,
    });
  });

  it("reports backup N-A when no backup reader is configured", async () => {
    const status = await collectBoxStatus(base);
    expect(status.backup).toEqual({ configured: false });
  });

  it("propagates a backup reader fault (fail-loud, no configured:false fallback)", async () => {
    await expect(
      collectBoxStatus({
        ...base,
        backup: () => Promise.reject(new Error("backup dir read failed")),
      }),
    ).rejects.toThrow("backup dir read failed");
  });
});
