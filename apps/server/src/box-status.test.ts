import { describe, expect, it } from "vitest";
import { collectBoxStatus, type BoxStatusReaders } from "./box-status.js";

const base: BoxStatusReaders = {
  mode: async () => "primary",
  singletonRole: async () => "primary",
  environment: "preproduction",
  time: async () => ({ synced: true, source: "timedatectl", warn: false }),
  cert: () => Promise.resolve({ notAfter: "2030-01-01T00:00:00.000Z", daysRemaining: 30 }),
  awaitingFiscalCertificate: () => false,
  chain: async () => ({ height: 7, lastAt: "2026-08-29T10:00:00.000Z" }),
  backup: undefined,
  stream: () => ({ state: "off" }),
  duties: () => ({ "fiscal.drain": { stale: false } }),
};

describe("collectBoxStatus", () => {
  it("composes every field with cert available and backup N-A", async () => {
    const status = await collectBoxStatus(base);
    expect(status).toEqual({
      mode: "primary",
      singletonRole: "primary",
      environment: "preproduction",
      time: { synced: true, source: "timedatectl", warn: false },
      cert: { available: true, notAfter: "2030-01-01T00:00:00.000Z", daysRemaining: 30 },
      awaitingFiscalCertificate: false,
      chain: { height: 7, lastAt: "2026-08-29T10:00:00.000Z" },
      backup: { configured: false },
      stream: { state: "off" },
      duties: { "fiscal.drain": { stale: false } },
    });
  });

  it("passes the bucket copy through from its reader", async () => {
    const stream = {
      state: "streaming",
      generation: "gen-0-node-a-20260829T100000Z",
      reason: null,
      stateSince: "2026-08-29T10:00:00.000Z",
      bucketProblem: null,
      lagMs: 0,
      lastConfirmedUploadAt: "2026-08-29T10:00:01.000Z",
    } as const;
    const status = await collectBoxStatus({ ...base, stream: () => stream });
    expect(status.stream).toEqual(stream);
  });

  it("passes singletonRole through from its reader", async () => {
    const status = await collectBoxStatus({ ...base, singletonRole: async () => "secondary" });
    expect(status.singletonRole).toBe("secondary");
  });

  it("surfaces awaitingFiscalCertificate from its reader (a promoted mirror with no fiscal.aeat cert)", async () => {
    const status = await collectBoxStatus({ ...base, awaitingFiscalCertificate: () => true });
    expect(status.awaitingFiscalCertificate).toBe(true);
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

  it("passes a per-destination backup summary through from its reader", async () => {
    const status = await collectBoxStatus({
      ...base,
      backup: async () => ({
        configured: true,
        destinations: [
          {
            id: "primary",
            lastBackupAt: "2026-08-29T09:00:00.000Z",
            ageSeconds: 3600,
            stale: false,
          },
          { id: "offsite", lastBackupAt: null, ageSeconds: null, stale: true },
        ],
      }),
    });
    expect(status.backup).toEqual({
      configured: true,
      destinations: [
        { id: "primary", lastBackupAt: "2026-08-29T09:00:00.000Z", ageSeconds: 3600, stale: false },
        { id: "offsite", lastBackupAt: null, ageSeconds: null, stale: true },
      ],
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
