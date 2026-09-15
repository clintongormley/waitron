import { describe, expect, it } from "vitest";
import {
  backupAlertSource,
  type BackupOutcomeHolder,
  recordBackupOutcome,
} from "./alert-sources.js";
import type { BackupStatus } from "./backup-status.js";

const NOW = new Date("2026-09-15T12:00:00Z");
const ctx = { tx: {} as never, tenantId: "t1" as never, now: NOW };

function src(status: BackupStatus, outcomes: BackupOutcomeHolder) {
  return backupAlertSource({ listStatus: async () => status, outcomes, now: () => NOW });
}

describe("backupAlertSource", () => {
  it("raises backup.disabled when not configured", async () => {
    const alerts = await src({ configured: false }, { failed: new Map() }).read(ctx);
    expect(alerts.map((a) => a.code)).toEqual(["backup.disabled"]);
    expect(alerts[0].severity).toBe("warning");
  });

  it("raises destination_overdue for a stale destination, with the last good backup as since", async () => {
    const status: BackupStatus = {
      configured: true,
      destinations: [
        { id: "local", lastBackupAt: "2026-09-10T00:00:00Z", ageSeconds: 999999, stale: true },
      ],
    };
    const alerts = await src(status, { failed: new Map() }).read(ctx);
    const overdue = alerts.find((a) => a.code === "backup.destination_overdue");
    expect(overdue).toMatchObject({
      key: "backup.destination_overdue:local",
      severity: "error",
      since: "2026-09-10T00:00:00Z",
      screen: "backup",
      params: { destination: "local" },
    });
  });

  it("raises nothing for a fresh, non-failed destination", async () => {
    const status: BackupStatus = {
      configured: true,
      destinations: [{ id: "local", lastBackupAt: NOW.toISOString(), ageSeconds: 5, stale: false }],
    };
    expect(await src(status, { failed: new Map() }).read(ctx)).toEqual([]);
  });

  it("raises destination_failed from the outcome holder, cleared by a success", async () => {
    const outcomes: BackupOutcomeHolder = { failed: new Map() };
    recordBackupOutcome(outcomes, "local", false, "2026-09-15T11:59:00Z");
    const status: BackupStatus = {
      configured: true,
      destinations: [{ id: "local", lastBackupAt: NOW.toISOString(), ageSeconds: 5, stale: false }],
    };
    let alerts = await src(status, outcomes).read(ctx);
    expect(alerts).toMatchObject([
      {
        code: "backup.destination_failed",
        severity: "warning",
        since: "2026-09-15T11:59:00Z",
        params: { destination: "local" },
      },
    ]);
    recordBackupOutcome(outcomes, "local", true, NOW.toISOString());
    alerts = await src(status, outcomes).read(ctx);
    expect(alerts).toEqual([]);
  });
});
