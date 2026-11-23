import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { incidents, printers, withTransaction } from "@waitron/db";
import { cardReaders } from "@waitron/payments";
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
import { cloudProblemReportsJob, createCloudProblemReports } from "./cloud-problem-reports.js";
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
    reports: (version = "1.2.3", isPrimary = () => true, paymentsEnabled?: boolean) =>
      createCloudProblemReports({
        db: suite.db,
        stateDir,
        venueDir,
        environment: "preproduction",
        nodeId: "this-box",
        version,
        paymentsEnabled,
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

it.each([
  ["refusal", false],
  ["refusal", true],
  ["changed registration", false],
] as const)("retires pending work after %s (administrator %s)", async (change, admin) => {
  const f = await fixture();
  const reports = f.reports();
  const preview = await reports.preview("dashboard", "alice");
  expect(preview.available).toBe(true);
  if (!preview.available) return;
  f.delivered.mockResolvedValueOnce("retry").mockResolvedValueOnce("stop");
  expect(
    await reports.send("dashboard", "alice", preview.id, { text: "Drawer jammed", admin }),
  ).toBe("queued");
  if (change === "changed registration") f.registration("second");
  const restarted = f.reports();
  await restarted.run(signal());
  await restarted.run(signal());
  expect(f.delivered).toHaveBeenCalledTimes(change === "refusal" ? 2 : 1);
  expect(await readFile(join(f.stateDir, "cloud/problem-reports.json"), "utf8")).not.toContain(
    "Drawer jammed",
  );
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
  const reports = f.reports();
  mountProblemReportApi(app, { db, reports }, () => {});
  const base = "/management-api/problem-reports";
  const preview = await app.request(`${base}/preview`, { headers: first });
  const { id } = await preview.json();
  const send = (headers: HeadersInit) =>
    app.request(`${base}/${id}/send`, {
      method: "POST",
      headers,
      body: JSON.stringify({ description: "Drawer jammed" }),
    });

  const refused = await send(second);
  expect(refused.status).toBe(400);
  expect(await refused.json()).toMatchObject({ error: { code: "cloud.request_invalid" } });
  expect(await (await send(first)).json()).toEqual({ delivery: "sent", description: "queued" });
  await reports.run(signal());
  expect(f.delivered.mock.calls[1]?.[2]).toBe(
    JSON.stringify({ reportId: id, description: "Drawer jammed", time: 1767225600000 }),
  );
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

/** Scripts whether this box is the main box: each queued answer is used once, then `steady`. */
function primaryScript(steady = true) {
  const answers: boolean[] = [];
  const isPrimary = () => answers.shift() ?? steady;
  return { isPrimary, next: (...values: boolean[]) => answers.push(...values) };
}

const queueFile = (stateDir: string) => join(stateDir, "cloud/problem-reports.json");

it("names a printer, and a card reader only when payments are on, in the preview's equipment", async () => {
  const f = await fixture();
  await suite.db.insert(printers).values({ name: "Bar", transport: "cloud_poll", pollId: "bar" });
  await suite.db
    .insert(cardReaders)
    .values({ provider: "stub", providerRef: "r1", name: "Reader" });
  const equipment = async (paymentsEnabled?: boolean) => {
    const preview = await f.reports("1.2.3", () => true, paymentsEnabled).preview("till", "a");
    if (!preview.available) throw new Error("Preview unavailable");
    return JSON.parse(preview.attachment).details.equipment;
  };
  expect(await equipment(true)).toEqual(["printer", "card_reader"]);
  expect(await equipment()).toEqual(["printer"]);
});

it.each([
  ["blank", "   "],
  ["holding a control character", "Drawer\u0007jammed"],
  ["over 2000 characters", "x".repeat(2001)],
])("refuses a description that is %s without sending or saving anything", async (_, text) => {
  const f = await fixture();
  const reports = f.reports();
  const preview = await reports.preview("till", "staff");
  if (!preview.available) throw new Error("Preview unavailable");
  await expect(
    reports.send("till", "staff", preview.id, { text, admin: false }),
  ).rejects.toMatchObject({ code: "cloud.request_invalid" });
  expect(f.delivered).not.toHaveBeenCalled();
  await expect(readFile(queueFile(f.stateDir), "utf8")).rejects.toMatchObject({
    code: "ENOENT",
  });
});

it.each([
  ["text that is not JSON", "{"],
  ["a queue without a registration", JSON.stringify({ pending: [], drafts: [] })],
  ["a pending entry without an id", JSON.stringify({ registration: "first", pending: [{}] })],
])("refuses to read a saved queue holding %s", async (_, contents) => {
  const f = await fixture();
  await mkdir(dirname(queueFile(f.stateDir)), { recursive: true });
  await writeFile(queueFile(f.stateDir), contents);
  await expect(f.reports().descriptions()).rejects.toMatchObject({ code: "cloud.state_invalid" });
});

it("passes on a saved queue it cannot open as a file", async () => {
  const f = await fixture();
  await mkdir(queueFile(f.stateDir), { recursive: true });
  await expect(f.reports().descriptions()).rejects.toMatchObject({ code: "EISDIR" });
});

it("refuses each step, and lists no descriptions, once this box stops being the main box partway through", async () => {
  const f = await fixture();
  const primary = primaryScript();
  const reports = f.reports("1.2.3", primary.isPrimary);
  const preview = await reports.preview("till", "staff");
  if (!preview.available) throw new Error("Preview unavailable");
  f.delivered.mockResolvedValueOnce("retry");
  await reports.send("till", "staff", preview.id, { text: "Drawer jammed", admin: false });

  primary.next(true, false);
  expect(await reports.preview("till", "other")).toEqual({ available: false });

  primary.next(true, false, false);
  await expect(reports.decideDescription(preview.id, "send")).rejects.toMatchObject({
    code: "cloud.not_primary",
  });
  primary.next(false);
  await expect(reports.decideDescription(preview.id, "send")).rejects.toMatchObject({
    code: "cloud.not_primary",
  });
  primary.next(false);
  expect(await reports.descriptions()).toEqual([]);
  expect(await reports.descriptions()).toEqual([
    { reportId: preview.id, description: "Drawer jammed", time: 1767225600000 },
  ]);

  const second = await reports.preview("till", "second");
  if (!second.available) throw new Error("Preview unavailable");
  primary.next(false);
  await expect(reports.send("till", "second", second.id)).rejects.toMatchObject({
    code: "cloud.not_primary",
  });
  const third = await reports.preview("till", "third");
  if (!third.available) throw new Error("Preview unavailable");
  primary.next(true, false);
  await expect(reports.send("till", "third", third.id)).rejects.toMatchObject({
    code: "cloud.not_primary",
  });
  expect(f.delivered).toHaveBeenCalledTimes(1);
  expect(await readFile(queueFile(f.stateDir), "utf8")).not.toContain(third.id);
});

it("keeps a report queued unsent when the box stops being the main box just before sending", async () => {
  const f = await fixture();
  const primary = primaryScript();
  const reports = f.reports("1.2.3", primary.isPrimary);
  const preview = await reports.preview("till", "staff");
  if (!preview.available) throw new Error("Preview unavailable");
  primary.next(true, true, false);
  expect(await reports.send("till", "staff", preview.id)).toBe("queued");
  expect(f.delivered).not.toHaveBeenCalled();
  expect(await readFile(queueFile(f.stateDir), "utf8")).toContain(preview.id);
  await reports.run(signal());
  expect(f.delivered.mock.calls.map((call) => call[1])).toEqual([preview.id]);
});

it("refuses a description decision for a report it does not hold", async () => {
  const f = await fixture();
  await expect(
    f.reports().decideDescription("00000000-0000-4000-8000-000000000000", "send"),
  ).rejects.toMatchObject({ code: "cloud.request_invalid" });
});

it("refuses a preview that was made under a registration since replaced", async () => {
  const f = await fixture();
  const reports = f.reports();
  const preview = await reports.preview("till", "staff");
  if (!preview.available) throw new Error("Preview unavailable");
  f.registration("second");
  await expect(reports.send("till", "staff", preview.id)).rejects.toMatchObject({
    code: "cloud.not_configured",
  });
  expect(f.delivered).not.toHaveBeenCalled();
});

it("refuses a preview replaced by a newer one while its send was being checked", async () => {
  const f = await fixture();
  const reports = f.reports();
  const preview = await reports.preview("till", "staff");
  if (!preview.available) throw new Error("Preview unavailable");
  const sending = reports.send("till", "staff", preview.id);
  const newer = await reports.preview("till", "staff");
  await expect(sending).rejects.toMatchObject({ code: "cloud.request_invalid" });
  expect(newer.available).toBe(true);
  expect(f.delivered).not.toHaveBeenCalled();
});

it("drops an old registration's queue when a new report is saved, and says so in the log", async () => {
  const f = await fixture();
  const reports = f.reports();
  const old = await reports.preview("till", "staff");
  if (!old.available) throw new Error("Preview unavailable");
  f.delivered.mockResolvedValueOnce("retry");
  await reports.send("till", "staff", old.id);
  f.registration("second");
  const next = await reports.preview("till", "staff");
  if (!next.available) throw new Error("Preview unavailable");
  expect(await reports.send("till", "staff", next.id)).toBe("sent");
  expect(f.log.mock.calls).toEqual([["warn", "cloud.not_configured"]]);
  expect(f.delivered.mock.calls.map((call) => call.slice(0, 2))).toEqual([
    ["first", old.id],
    ["second", next.id],
  ]);
  expect(await readFile(queueFile(f.stateDir), "utf8")).not.toContain(old.id);
});

it("queues a second report behind one still waiting, without sending it ahead", async () => {
  const f = await fixture();
  const reports = f.reports();
  const first = await reports.preview("till", "a");
  const second = await reports.preview("till", "b");
  if (!first.available || !second.available) throw new Error("Preview unavailable");
  f.delivered.mockResolvedValueOnce("retry");
  expect(await reports.send("till", "a", first.id)).toBe("queued");
  expect(await reports.send("till", "b", second.id)).toBe("queued");
  expect(f.delivered.mock.calls.map((call) => call[1])).toEqual([first.id]);
  await reports.run(signal());
  await reports.run(signal());
  expect(f.delivered.mock.calls.map((call) => call[1])).toEqual([first.id, first.id, second.id]);
});

it("refuses a report the Cloud refuses outright", async () => {
  const f = await fixture();
  const reports = f.reports();
  const preview = await reports.preview("till", "staff");
  if (!preview.available) throw new Error("Preview unavailable");
  f.delivered.mockResolvedValueOnce("stop");
  await expect(reports.send("till", "staff", preview.id)).rejects.toMatchObject({
    code: "cloud.request_invalid",
  });
  expect(f.log.mock.calls).toEqual([["warn", "cloud.request_invalid"]]);
});

it("says the queue is busy once sixteen reports are waiting to be sent", async () => {
  const f = await fixture();
  const reports = f.reports();
  f.delivered.mockResolvedValue("retry");
  for (let index = 0; index < 16; index += 1) {
    const preview = await reports.preview("till", `s${index}`);
    if (!preview.available) throw new Error("Preview unavailable");
    expect(await reports.send("till", `s${index}`, preview.id)).toBe("queued");
  }
  const extra = await reports.preview("till", "extra");
  if (!extra.available) throw new Error("Preview unavailable");
  await expect(reports.send("till", "extra", extra.id)).rejects.toMatchObject({
    code: "cloud.busy",
  });
  expect(await readFile(queueFile(f.stateDir), "utf8")).not.toContain(extra.id);
});

it("refuses a seventeenth description awaiting review once the reports themselves were sent", async () => {
  const f = await fixture();
  const reports = f.reports();
  for (let index = 0; index < 16; index += 1) {
    const preview = await reports.preview("till", `s${index}`);
    if (!preview.available) throw new Error("Preview unavailable");
    const description = { text: `Note ${index}`, admin: false };
    expect(await reports.send("till", `s${index}`, preview.id, description)).toBe("sent");
  }
  expect(await reports.descriptions()).toHaveLength(16);
  const extra = await reports.preview("till", "extra");
  if (!extra.available) throw new Error("Preview unavailable");
  await expect(
    reports.send("till", "extra", extra.id, { text: "One too many", admin: false }),
  ).rejects.toMatchObject({ code: "cloud.busy" });
  expect(await readFile(queueFile(f.stateDir), "utf8")).not.toContain("One too many");
  expect(await reports.send("till", "extra", extra.id)).toBe("sent");
});

it("drops the oldest preview when a 257th is made, keeping the next oldest", async () => {
  const f = await fixture();
  const reports = f.reports();
  const oldest = await reports.preview("till", "s0");
  const nextOldest = await reports.preview("till", "s1");
  if (!oldest.available || !nextOldest.available) throw new Error("Preview unavailable");
  for (let index = 2; index <= 256; index += 1) await reports.preview("till", `s${index}`);
  await expect(reports.send("till", "s0", oldest.id)).rejects.toMatchObject({
    code: "cloud.request_invalid",
  });
  expect(await reports.send("till", "s1", nextOldest.id)).toBe("sent");
});

it("runs the queue as a job that comes back sooner only while a report is waiting", async () => {
  const f = await fixture();
  const reports = f.reports();
  const job = cloudProblemReportsJob(reports, () => true);
  expect(job.applies()).toBe(true);
  expect(await job.pass({ now: new Date(), signal: signal() })).toEqual({ nextDueAt: null });

  const preview = await reports.preview("till", "staff");
  if (!preview.available) throw new Error("Preview unavailable");
  f.delivered.mockResolvedValueOnce("retry");
  await reports.send("till", "staff", preview.id);
  let release!: () => void;
  f.delivered.mockImplementationOnce(
    () => new Promise((resolve) => (release = () => resolve("retry"))),
  );
  const before = Date.now();
  const passing = job.pass({ now: new Date(), signal: signal() });
  await vi.waitFor(() => expect(f.delivered).toHaveBeenCalledTimes(2));
  expect(await reports.run(signal())).toBeUndefined();
  release();
  const { nextDueAt } = await passing;
  const after = Date.now();
  expect(nextDueAt!.getTime()).toBeGreaterThanOrEqual(before + 30_000);
  expect(nextDueAt!.getTime()).toBeLessThanOrEqual(after + 30_000);
  expect(f.delivered).toHaveBeenCalledTimes(2);

  expect((await job.pass({ now: new Date(), signal: signal() })).nextDueAt).not.toBeNull();
  expect(f.delivered).toHaveBeenCalledTimes(3);
  expect(await job.pass({ now: new Date(), signal: signal() })).toEqual({ nextDueAt: null });
  expect(f.delivered).toHaveBeenCalledTimes(3);
});
