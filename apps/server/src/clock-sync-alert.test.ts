import { describe, expect, it } from "vitest";
import type { ClockServiceStatus } from "./box-host-client.js";
import { clockSyncAlertSource } from "./clock-sync-alert.js";

const NOW = new Date("2026-10-31T10:00:00.000Z");

function answering(
  service: "on" | "off" | "stopped",
  synchronised: boolean,
): () => Promise<ClockServiceStatus> {
  return async () => ({
    available: true,
    service,
    unit: service === "off" ? null : "systemd-timesyncd.service",
    synchronised,
    lastSyncAt: null,
  });
}

const unavailable = async (): Promise<ClockServiceStatus> => ({
  available: false,
  reason: "missing",
  detail: "ENOENT",
});

const read = (status: () => Promise<ClockServiceStatus>, production: boolean) =>
  clockSyncAlertSource({ status, production }).read({ tx: {} as never, now: NOW });

const raised = (reason: string) => [
  {
    key: "clock.sync_off",
    code: "clock.sync_off",
    severity: "warning",
    since: null,
    screen: "box-status",
    params: { reason },
  },
];

describe("clockSyncAlertSource", () => {
  it("is claimed by the box area, for whoever manages the system", () => {
    const source = clockSyncAlertSource({ status: unavailable, production: true });
    expect(source.area).toBe("box");
    expect(source.permission).toBe("system.manage");
  });

  it("raises nothing while the time service runs and is synchronised", async () => {
    expect(await read(answering("on", true), true)).toEqual([]);
  });

  it("raises `off` when the time service is switched off", async () => {
    expect(await read(answering("off", false), true)).toEqual(raised("off"));
  });

  it("raises `stopped` when the time service is on but no time unit is running", async () => {
    expect(await read(answering("stopped", false), true)).toEqual(raised("stopped"));
  });

  it("raises `unsynchronised` when the time service runs but has not synchronised", async () => {
    expect(await read(answering("on", false), true)).toEqual(raised("unsynchronised"));
  });

  it("raises `unreachable` on a production box whose clock service does not answer", async () => {
    expect(await read(unavailable, true)).toEqual(raised("unreachable"));
  });

  it("raises nothing where the clock service cannot be expected, outside production", async () => {
    expect(await read(unavailable, false)).toEqual([]);
  });

  it("still raises a real time-service fault outside production", async () => {
    expect(await read(answering("off", false), false)).toEqual(raised("off"));
  });
});
