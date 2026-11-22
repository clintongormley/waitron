import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { incidents, withTransaction } from "@waitron/db";
import { seedTaxpayer } from "@waitron/db/testing/seed.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { startManagementSession } from "@waitron/identity";
import { seedPersons } from "@waitron/identity/test/person-rows.js";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { expect, it, onTestFinished, vi } from "vitest";
import type { CloudConnection } from "./cloud-client.js";
import { createCloudProblemReports } from "./cloud-problem-reports.js";
import { mountProblemReportApi } from "./problem-report-api.js";

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
  let now = new Date("2026-01-01T00:00:00Z");
  return {
    stateDir,
    delivered,
    log,
    setNow: (time: string) => {
      now = new Date(time);
    },
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
        now: () => now,
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

it("refuses a dashboard preview sent from another sign-in by the same person", async () => {
  const f = await fixture();
  const db = suite.db;
  const [person] = await seedPersons(db, { displayName: "Manager", role: "admin" });
  const signIn = async () => {
    const { token } = await withTransaction(db, (tx) =>
      startManagementSession(tx, { personId: person!.id, method: "password" }),
    );
    return { cookie: `${MANAGEMENT_COOKIE}=${token}` };
  };
  const first = await signIn();
  const second = await signIn();
  const app = new Hono();
  mountProblemReportApi(app, { db, reports: f.reports() }, () => {});
  const base = "/management-api/problem-reports";
  const preview = await app.request(`${base}/preview`, { headers: first });
  const { id } = await preview.json();
  const send = (headers: HeadersInit) =>
    app.request(`${base}/${id}/send`, { method: "POST", headers });

  const refused = await send(second);
  expect(refused.status).toBe(400);
  expect(await refused.json()).toMatchObject({ error: { code: "cloud.request_invalid" } });
  expect(await (await send(first)).json()).toEqual({ delivery: "sent" });
});

it("keeps staff text local until approval and retries the same signed description after restart", async () => {
  const f = await fixture();
  const reports = f.reports();
  const preview = await reports.preview("till", "staff");
  if (!preview.available) throw new Error("Preview unavailable");
  f.delivered.mockResolvedValueOnce("retry");
  await expect(
    reports.send("till", "staff", preview.id, { text: "First\r\nSecond", admin: false }),
  ).resolves.toBe("queued");

  expect(await readFile(join(f.stateDir, "cloud/problem-reports.json"), "utf8")).toContain("First");
  const restarted = f.reports();
  await restarted.run(signal());
  await restarted.run(signal());
  expect(f.delivered.mock.calls.map((call) => call[2])).toEqual([
    preview.attachment,
    preview.attachment,
  ]);
  expect(await restarted.descriptions()).toEqual([
    { reportId: preview.id, description: "First\nSecond", time: 1767225600000 },
  ]);
  f.setNow("2026-01-02T00:00:00Z");
  await restarted.decideDescription(preview.id, "send");
  f.delivered.mockResolvedValueOnce("retry");
  await restarted.run(signal());
  await f.reports().run(signal());
  const [first, second] = f.delivered.mock.calls.slice(2);
  expect(first?.[1]).not.toBe(preview.id);
  expect(first?.[2]).toBe(
    JSON.stringify({ reportId: preview.id, description: "First\nSecond", time: 1767225600000 }),
  );
  expect(first?.[4]).toBe("staff-description");
  expect(second?.slice(0, 3)).toEqual(first?.slice(0, 3));
  expect(await readFile(join(f.stateDir, "cloud/problem-reports.json"), "utf8")).not.toContain(
    "First",
  );
});

it.each(["discard", "expire", "stop"] as const)("erases a description on %s", async (decision) => {
  const f = await fixture();
  const reports = f.reports();
  const preview = await reports.preview("dashboard", "staff");
  if (!preview.available) throw new Error("Preview unavailable");
  await reports.send("dashboard", "staff", preview.id, { text: "Private draft", admin: false });
  if (decision === "discard") await reports.decideDescription(preview.id, "discard");
  if (decision === "expire") f.setNow("2026-01-31T00:00:00Z");
  if (decision === "stop") {
    await reports.decideDescription(preview.id, "send");
    f.delivered.mockResolvedValueOnce("stop");
  }
  await reports.run(signal());
  expect(f.delivered).toHaveBeenCalledTimes(decision === "stop" ? 2 : 1);
  expect(await readFile(join(f.stateDir, "cloud/problem-reports.json"), "utf8")).not.toContain(
    "Private draft",
  );
  expect(await reports.descriptions()).toEqual([]);
  expect(JSON.stringify(f.log.mock.calls)).not.toContain("Private draft");
});

it("queues an administrator's text behind its diagnostics without a separate approval", async () => {
  const f = await fixture();
  const reports = f.reports();
  const preview = await reports.preview("dashboard", "admin");
  if (!preview.available) throw new Error("Preview unavailable");
  f.delivered.mockResolvedValueOnce("retry");
  await reports.send("dashboard", "admin", preview.id, { text: "Printer jammed", admin: true });
  await reports.run(signal());
  await reports.run(signal());
  expect(f.delivered.mock.calls.map((call) => call[2])).toEqual([
    preview.attachment,
    preview.attachment,
    JSON.stringify({ reportId: preview.id, description: "Printer jammed", time: 1767225600000 }),
  ]);
  expect(await reports.descriptions()).toEqual([]);
});
