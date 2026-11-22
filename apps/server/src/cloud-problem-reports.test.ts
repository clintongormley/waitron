import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { incidents } from "@waitron/db";
import { seedTaxpayer } from "@waitron/db/testing/seed.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { sql } from "drizzle-orm";
import { expect, it, onTestFinished, vi } from "vitest";
import type { CloudConnection } from "./cloud-client.js";
import { createCloudProblemReports } from "./cloud-problem-reports.js";

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
const signal = () => new AbortController().signal;

async function fixture() {
  const stateDir = await mkdtemp(join(tmpdir(), "waitron-problem-reports-"));
  onTestFinished(() => rm(stateDir, { recursive: true, force: true }));
  await seedTaxpayer(suite.db);
  const venueDir = dirname(suite.db.get<{ file: string }>(sql`pragma database_list`)!.file);
  let registration: string | undefined = "first";
  const delivered = vi.fn<CloudConnection["sendStaffReport"]>(async () => "sent");
  const log = vi.fn();
  return {
    stateDir,
    delivered,
    log,
    registration: (next: string | undefined) => {
      registration = next;
    },
    reports: (version = "1.2.3", isPrimary = () => true) =>
      createCloudProblemReports({
        db: suite.db,
        stateDir,
        venueDir,
        environment: "preproduction",
        nodeId: "this-box",
        version,
        isPrimary,
        now: () => new Date("2026-01-01T00:00:00Z"),
        log,
        connection: {
          errorReportRegistration: async () => registration,
          sendStaffReport: delivered,
        },
      }),
  };
}

it("keeps exact preview bytes across an offline restart and omits incident details", async () => {
  const f = await fixture();
  await suite.db.insert(incidents).values({
    source: "backup",
    code: "storage.disk_full",
    severity: "error",
    detectedAt: "2026-01-01T00:00:00.000Z",
    params: { guestName: "Private Guest" },
  });
  const reports = f.reports();
  const preview = await reports.preview("till", "alice");
  expect(preview.available).toBe(true);
  if (!preview.available) return;
  expect(preview.attachment).toBe(
    JSON.stringify({
      version: "1.2.3",
      time: 1767225600000,
      logs: [{ level: "error", code: "storage.disk_full", source: "backup" }],
      details: { device: "till", equipment: [], upgradedAt: null, hosting: "unknown" },
    }),
  );
  await suite.db.insert(incidents).values({
    source: "backup",
    code: "backup.stream_behind",
    severity: "error",
    detectedAt: "2026-01-01T00:00:00.000Z",
  });
  await expect(reports.send("till", "bob", preview.id)).rejects.toMatchObject({
    code: "cloud.request_invalid",
  });
  f.delivered.mockResolvedValueOnce("retry");
  expect(await reports.send("till", "alice", preview.id)).toBe("queued");
  expect(await readFile(join(f.stateDir, "cloud/problem-reports.json"), "utf8")).not.toContain(
    "Private Guest",
  );

  const restarted = f.reports();
  await restarted.run(signal());
  await restarted.run(signal());
  expect(f.delivered.mock.calls.map((args) => args.slice(0, 3))).toEqual([
    ["first", preview.id, preview.attachment],
    ["first", preview.id, preview.attachment],
  ]);
});

it.each(["refusal", "changed registration"])("retires pending work after %s", async (change) => {
  const f = await fixture();
  const reports = f.reports();
  const preview = await reports.preview("dashboard", "alice");
  expect(preview.available).toBe(true);
  if (!preview.available) return;
  f.delivered.mockResolvedValueOnce("retry").mockResolvedValueOnce("stop");
  expect(await reports.send("dashboard", "alice", preview.id)).toBe("queued");
  if (change === "changed registration") f.registration("second");
  const restarted = f.reports();
  await restarted.run(signal());
  await restarted.run(signal());
  expect(f.delivered).toHaveBeenCalledTimes(change === "refusal" ? 2 : 1);
  expect(f.log.mock.calls).toEqual([
    ["warn", change === "refusal" ? "cloud.request_invalid" : "cloud.not_configured"],
  ]);
});

it("only offers sending on the main box with a stamped stable release and a registration", async () => {
  const f = await fixture();
  for (const reports of [
    f.reports("01.2.3"),
    f.reports("2147483648.0.0"),
    f.reports("1.2.3", () => false),
  ]) {
    expect(await reports.preview("dashboard", "alice")).toEqual({ available: false });
  }
  f.registration(undefined);
  expect(await f.reports().preview("dashboard", "alice")).toEqual({ available: false });
});
