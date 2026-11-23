import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CORE_MIGRATIONS, incidents } from "@waitron/db";
import { seedTaxpayer } from "@waitron/db/testing/seed.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { AppError } from "@waitron/shared";
import { CLOUD_ERROR_REPORTS_FILE, VENUE_FILE } from "@waitron/store";
import { sql } from "drizzle-orm";
import { beforeEach, expect, it, onTestFinished, vi } from "vitest";
import type { CloudConnection } from "./cloud-client.js";
import { cloudErrorReportsJob, createCloudErrorReports } from "./cloud-error-reports.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
beforeEach(() => seedTaxpayer(suite.db));
const signal = () => new AbortController().signal;
const day = "2026-01-01";

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "waitron-error-reports-"));
  onTestFinished(() => rm(dir, { recursive: true, force: true }));
  await writeFile(join(dir, VENUE_FILE), "first file");
  let registration: string | undefined = "registration-one";
  const sendErrorReport = vi.fn<CloudConnection["sendErrorReport"]>(async () => {});
  return {
    dir,
    sendErrorReport,
    registration(next: string | undefined) {
      registration = next;
    },
    async replaceDatabaseFile() {
      const next = join(dir, "replacement");
      await writeFile(next, "replacement file");
      await rename(next, join(dir, VENUE_FILE));
    },
    reports: () =>
      createCloudErrorReports({
        db: suite.db,
        stateDir: dir,
        venueDir: dir,
        environment: "production",
        connection: { errorReportRegistration: async () => registration, sendErrorReport },
      }),
  };
}

async function incident(minute: number, overrides: Partial<typeof incidents.$inferInsert> = {}) {
  const detectedAt = `${day}T00:${String(minute).padStart(2, "0")}:00.000Z`;
  await suite.db.insert(incidents).values({
    code: "storage.disk_full",
    source: "backup",
    releaseVersion: "1.10.0",
    detectedAt,
    acknowledgedAt: detectedAt,
    severity: "error",
    params: { guestName: "Private" },
    ...overrides,
  });
}

it("starts off and groups only eligible incidents from after opt-in", async () => {
  const f = await fixture();
  const sender = f.reports();
  await incident(0);
  expect(await sender.enabled()).toBe(false);
  await sender.run(signal());
  expect(f.sendErrorReport).not.toHaveBeenCalled();
  await sender.setEnabled(true);
  await incident(1);
  await incident(2);
  await incident(3, { releaseVersion: "1.11.0" });
  await incident(4, { severity: "warning" });
  await incident(5, { releaseVersion: null });
  await sender.run(signal());
  await sender.run(signal());
  await sender.run(signal());
  expect(f.sendErrorReport.mock.calls.map(([, , body]) => JSON.parse(body))).toEqual([
    {
      code: "storage.disk_full",
      source: "backup",
      version: "1.10.0",
      time: 1767225720000,
      count: 2,
      logs: [],
    },
    {
      code: "storage.disk_full",
      source: "backup",
      version: "1.11.0",
      time: 1767225780000,
      count: 1,
      logs: [],
    },
  ]);
});

it("carries excess occurrences into the next report", async () => {
  const f = await fixture();
  const sender = f.reports();
  await sender.setEnabled(true);
  await suite.db.execute(sql`
    with recursive sequence(i) as (values (1) union all select i + 1 from sequence where i < 501)
    insert into incidents (id, source, code, severity, detected_at, acknowledged_at, release_version)
    select lower(hex(randomblob(16))), 'backup', 'storage.disk_full', 'error',
      '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', '1.10.0'
    from sequence
  `);
  await sender.run(signal());
  await sender.run(signal());
  expect(f.sendErrorReport.mock.calls.map(([, , body]) => JSON.parse(body).count)).toEqual([
    500, 1,
  ]);
});

it("replays the exact report after a lost reply and restart", async () => {
  const f = await fixture();
  const sender = f.reports();
  await sender.setEnabled(true);
  await incident(1);
  f.sendErrorReport.mockRejectedValueOnce(new AppError("cloud.unavailable", {}));
  await expect(sender.run(signal())).rejects.toMatchObject({ code: "cloud.unavailable" });
  await incident(2);
  const restarted = f.reports();
  await restarted.run(signal());
  await restarted.run(signal());
  expect(f.sendErrorReport.mock.calls).toHaveLength(3);
  expect(f.sendErrorReport.mock.calls[1]?.slice(0, 3)).toEqual(
    f.sendErrorReport.mock.calls[0]?.slice(0, 3),
  );
  expect(f.sendErrorReport.mock.calls[2]?.[1]).not.toBe(f.sendErrorReport.mock.calls[0]?.[1]);
  expect(JSON.parse(f.sendErrorReport.mock.calls[2]![2]).time).toBe(1767225720000);
});

it.each(["opt-out", "database replacement", "registration replacement", "revocation"])(
  "discards the old queue after %s",
  async (change) => {
    const f = await fixture();
    const sender = f.reports();
    await sender.setEnabled(true);
    await incident(1);
    f.sendErrorReport.mockRejectedValueOnce(new AppError("cloud.unavailable", {}));
    await expect(sender.run(signal())).rejects.toMatchObject({ code: "cloud.unavailable" });
    if (change === "opt-out") await sender.setEnabled(false);
    if (change === "database replacement") await f.replaceDatabaseFile();
    if (change === "registration replacement") f.registration("registration-two");
    if (change === "revocation") f.registration(undefined);
    await incident(2);
    const restarted = f.reports();
    await restarted.run(signal());
    if (change === "opt-out") {
      expect(await restarted.enabled()).toBe(false);
      await restarted.setEnabled(true);
    }
    if (change === "revocation") {
      f.registration("registration-two");
      await restarted.run(signal());
    }
    expect(await restarted.enabled()).toBe(true);
    expect(f.sendErrorReport).toHaveBeenCalledTimes(1);
    await incident(3);
    await restarted.run(signal());
    expect(f.sendErrorReport).toHaveBeenCalledTimes(2);
    expect(JSON.parse(f.sendErrorReport.mock.calls[1]![2]).time).toBe(1767225780000);
  },
);

it("turning reporting off cancels a send in progress", async () => {
  const f = await fixture();
  const sender = f.reports();
  await sender.setEnabled(true);
  await incident(1);
  let reportStarted!: (request: AbortSignal) => void;
  const reached = new Promise<AbortSignal>((resolve) => {
    reportStarted = resolve;
  });
  let finishReply!: () => void;
  const reply = new Promise<void>((resolve) => {
    finishReply = resolve;
  });
  f.sendErrorReport.mockImplementationOnce(async (_registration, _id, _body, request) => {
    reportStarted(request!);
    await reply;
    request!.throwIfAborted();
  });
  const waiting = sender.run(signal());
  const request = await reached;
  try {
    await sender.setEnabled(false);
  } finally {
    finishReply();
  }
  expect(await waiting).toBe(false);
  expect(request.aborted).toBe(true);
});

it("holds opted-in incidents collected before the first registration", async () => {
  const f = await fixture();
  f.registration(undefined);
  const sender = f.reports();
  await sender.setEnabled(true);
  await incident(1);
  await sender.run(signal());
  expect(f.sendErrorReport).not.toHaveBeenCalled();
  f.registration("first-pairing");
  await sender.run(signal());
  expect(f.sendErrorReport.mock.calls[0]?.[0]).toBe("first-pairing");
  expect(JSON.parse(f.sendErrorReport.mock.calls[0]![2]).time).toBe(1767225660000);
});

it("moves past a permanent refusal", async () => {
  const f = await fixture();
  const sender = f.reports();
  await sender.setEnabled(true);
  await incident(1);
  await incident(2, { code: "storage.disk_nearly_full" });
  f.sendErrorReport.mockRejectedValueOnce(new AppError("cloud.request_invalid", {}));
  await sender.run(signal());
  await sender.run(signal());
  expect(f.sendErrorReport.mock.calls.map(([, , body]) => JSON.parse(body).code)).toEqual([
    "storage.disk_full",
    "storage.disk_nearly_full",
  ]);
});

it("remembers the initial registration even before the first report", async () => {
  const f = await fixture();
  f.registration(undefined);
  const sender = f.reports();
  await sender.setEnabled(true);
  f.registration("first-pairing");
  await sender.run(signal());
  await incident(1);
  f.registration("replacement");
  await sender.run(signal());
  expect(f.sendErrorReport).not.toHaveBeenCalled();
});

it("skips an error it cannot report and sends the next one", async () => {
  const f = await fixture();
  const sender = f.reports();
  await sender.setEnabled(true);
  await incident(1, { code: "Storage.Disk-Full" });
  await incident(2);
  expect(await sender.run(signal())).toBe(false);
  expect(await sender.run(signal())).toBe(true);
  expect(f.sendErrorReport.mock.calls.map(([, , body]) => JSON.parse(body).code)).toEqual([
    "storage.disk_full",
  ]);
});

it.each([
  ["not an object", "null"],
  ["not JSON", "{"],
])("treats a saved setting that is %s as switched off", async (_, contents) => {
  const f = await fixture();
  await mkdir(join(f.dir, "cloud"), { recursive: true });
  await writeFile(join(f.dir, CLOUD_ERROR_REPORTS_FILE), contents);
  const sender = f.reports();
  expect(await sender.enabled()).toBe(false);
  await incident(1);
  expect(await sender.run(signal())).toBe(false);
  expect(f.sendErrorReport).not.toHaveBeenCalled();
});

it("passes on a saved setting it cannot open as a file", async () => {
  const f = await fixture();
  await mkdir(join(f.dir, CLOUD_ERROR_REPORTS_FILE), { recursive: true });
  await expect(f.reports().enabled()).rejects.toMatchObject({ code: "EISDIR" });
});

it("keeps an earlier choice when asked only to set a starting value", async () => {
  const f = await fixture();
  const sender = f.reports();
  await sender.setEnabled(true);
  expect(await sender.setEnabled(false, true)).toBe(true);
  expect(await sender.enabled()).toBe(true);
});

it("refuses to switch reporting on before the venue is set up", async () => {
  const f = await fixture();
  await suite.db.run(sql`delete from taxpayer`);
  await expect(f.reports().setEnabled(true)).rejects.toMatchObject({
    code: "cloud.not_configured",
  });
});

it("sends one report at a time and runs as a job that comes back sooner after a send", async () => {
  const f = await fixture();
  const sender = f.reports();
  const job = cloudErrorReportsJob(sender, () => true);
  expect(job.applies()).toBe(true);
  await sender.setEnabled(true);
  expect(await job.pass({ now: new Date(), signal: signal() })).toEqual({ nextDueAt: null });

  await incident(1);
  let finish!: () => void;
  f.sendErrorReport.mockImplementationOnce(
    () => new Promise<void>((resolve) => (finish = resolve)),
  );
  const before = Date.now();
  const passing = job.pass({ now: new Date(), signal: signal() });
  await vi.waitFor(() => expect(f.sendErrorReport).toHaveBeenCalledOnce());
  expect(await sender.run(signal())).toBe(false);
  finish();
  const { nextDueAt } = await passing;
  const after = Date.now();
  expect(nextDueAt!.getTime()).toBeGreaterThanOrEqual(before + 10_000);
  expect(nextDueAt!.getTime()).toBeLessThanOrEqual(after + 10_000);
  expect(f.sendErrorReport).toHaveBeenCalledOnce();
});

it("sends nothing and prepares no report when the pass is already cancelled", async () => {
  const f = await fixture();
  const sender = f.reports();
  await sender.setEnabled(true);
  await incident(1);
  const aborted = new AbortController();
  aborted.abort();
  expect(await sender.run(aborted.signal)).toBe(false);
  expect(f.sendErrorReport).not.toHaveBeenCalled();
  const saved = JSON.parse(await readFile(join(f.dir, CLOUD_ERROR_REPORTS_FILE), "utf8"));
  expect(saved.pending).toBeUndefined();
  expect(await sender.run(signal())).toBe(true);
  expect(f.sendErrorReport).toHaveBeenCalledOnce();
});
