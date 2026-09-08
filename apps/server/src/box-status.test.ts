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
  replicationSlots: undefined,
  replicationSubscription: undefined,
  disposal: undefined,
  backup: undefined,
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
      awaitingFiscalCertificate: false,
      chain: { height: 7, lastAt: "2026-08-29T10:00:00.000Z" },
      replication: { configured: false },
      disposal: { applicable: false },
      backup: { configured: false },
      duties: { "fiscal.drain": { stale: false } },
    });
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

  it("lists a PRIMARY's peer slots (publisher cell, bigint retainedBytes → string)", async () => {
    const status = await collectBoxStatus({
      ...base,
      replicationSlots: async () => [
        {
          slotName: "waitron_preproduction_sub_aa",
          active: true,
          walStatus: "reserved",
          retainedBytes: 4096n,
        },
        {
          slotName: "waitron_preproduction_sub_bb",
          active: false,
          walStatus: "lost",
          retainedBytes: null,
        },
      ],
    });
    expect(status.replication).toEqual({
      configured: true,
      role: "publisher",
      slots: [
        {
          peer: "waitron_preproduction_sub_aa",
          active: true,
          walStatus: "reserved",
          retainedBytes: "4096",
        },
        {
          peer: "waitron_preproduction_sub_bb",
          active: false,
          walStatus: "lost",
          retainedBytes: "0",
        },
      ],
    });
  });

  it("reports an empty publisher slot list as configured with no slots", async () => {
    const status = await collectBoxStatus({ ...base, replicationSlots: async () => [] });
    expect(status.replication).toEqual({ configured: true, role: "publisher", slots: [] });
  });

  it("reports a MIRROR's subscription (subscriber cell, incl. the narrowed publications, I6)", async () => {
    const status = await collectBoxStatus({
      ...base,
      replicationSlots: undefined,
      replicationSubscription: async () => ({
        name: "waitron_preproduction_sub_cc",
        exists: true,
        enabled: true,
        publications: ["waitron_preproduction_ledger"],
        workerUp: true,
        receivedLsn: "0/1600000",
        latestEndLsn: "0/1600000",
        applyErrorCount: 0,
        syncErrorCount: 1,
        tablesTotal: 10,
        tablesReady: 9,
      }),
    });
    expect(status.replication).toEqual({
      configured: true,
      role: "subscriber",
      enabled: true,
      workerUp: true,
      tablesReady: 9,
      tablesTotal: 10,
      applyErrorCount: 0,
      syncErrorCount: 1,
      publications: ["waitron_preproduction_ledger"],
    });
  });

  it("propagates a replicationSlots reader fault (fail-loud, no configured:false fallback)", async () => {
    await expect(
      collectBoxStatus({
        ...base,
        replicationSlots: () => Promise.reject(new Error("slot read failed")),
      }),
    ).rejects.toThrow("slot read failed");
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

  it("reports disposal N-A when no disposal reader is configured (a serving, unfenced node)", async () => {
    const status = await collectBoxStatus(base);
    expect(status.disposal).toEqual({ applicable: false });
  });

  it("surfaces the carrier + native slot-drain verdict when a disposal reader is present", async () => {
    const status = await collectBoxStatus({
      ...base,
      disposal: async () => ({
        carrierNodeId: "carrier",
        drained: false,
        active: true,
        walStatus: "reserved",
        retainedBytes: 8192n,
      }),
    });
    expect(status.disposal).toEqual({
      applicable: true,
      carrierNodeId: "carrier",
      drained: false,
      active: true,
      walStatus: "reserved",
      retainedBytes: "8192", // bigint → string
    });
  });

  it("passes a null retainedBytes through as null (an absent slot, not the string 'null')", async () => {
    const status = await collectBoxStatus({
      ...base,
      disposal: async () => ({
        carrierNodeId: "carrier",
        drained: true,
        active: false,
        walStatus: null,
        retainedBytes: null,
      }),
    });
    expect(status.disposal).toEqual({
      applicable: true,
      carrierNodeId: "carrier",
      drained: true,
      active: false,
      walStatus: null,
      retainedBytes: null,
    });
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
