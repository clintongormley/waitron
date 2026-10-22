import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { formatBytes } from "@waitron/dashboard-kit";
import type { AlertView, BoxHealth } from "../api/client.js";
import { formatIsoMinute } from "../date-utils.js";
import { alertMessage } from "../i18n/alerts.js";
import { es } from "../i18n/strings.js";
import { fill, setLocale, t } from "../i18n/t.js";
import { boxStatusRows, partOfAlert, partsOfNotice, type PartRow } from "./box-status-rows.js";

beforeEach(() => setLocale("en"));
afterEach(() => setLocale("en"));

const LAST_SALE = "2026-10-22T19:43:00.000Z";
const MEASURED = "2026-10-22T12:03:00.000Z";
const UPLOADED = "2026-10-22T19:44:00.000Z";

function quietHealth(overrides: Partial<BoxHealth> = {}): BoxHealth {
  return {
    at: "2026-10-22T19:45:00.000Z",
    sales: { lastAt: LAST_SALE },
    notices: [],
    noticesUnavailable: [],
    filing: true,
    stream: {
      state: "streaming",
      generation: "g1",
      reason: null,
      stateSince: "2026-10-22T08:00:00.000Z",
      bucketProblem: null,
      lagMs: 0,
      lastConfirmedUploadAt: UPLOADED,
    },
    clock: {
      authority: { state: "ok", driftSeconds: -2, measuredAt: MEASURED },
      sync: { synced: true, source: "unavailable", warn: false },
    },
    printers: [{ id: "p1", name: "Bar" }],
    readers: [{ id: "r1", name: "Reader 1" }],
    canFree: true,
    disk: {
      freeBytes: 1_800_000_000,
      totalBytes: 32_000_000_000,
      databaseBytes: 120_000_000,
      backupsBytes: 300_000_000,
      logBytes: 40_000_000,
      otherBytes: 29_740_000_000,
      stoppedSince: null,
      lowSince: null,
      reclaimable: { bytes: 45_000_000, backupRunning: false },
    },
    ...overrides,
  };
}

function notice(code: string, severity: "error" | "warning" | "notice", params = {}) {
  return { key: code, code, severity, params, owner: "box" };
}

function alert(code: string, area: string, overrides: Partial<AlertView> = {}): AlertView {
  return {
    key: `${code}:1`,
    kind: "ongoing",
    code,
    params: {},
    severity: "warning",
    since: "2026-10-22T19:00:00.000Z",
    area,
    ...overrides,
  };
}

function row(rows: PartRow[], id: PartRow["id"]): PartRow {
  const found = rows.find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(`no ${id} row`);
  return found;
}

const DISK_FULL = notice("storage.disk_full", "error");
const CLOCK_UNUSABLE = notice("clock.unusable", "error");

describe("partOfAlert", () => {
  it("puts each mapped kind of alert on its row", () => {
    expect(partOfAlert({ area: "printing", code: "printer.jobs_waiting" })).toBe("printers");
    expect(partOfAlert({ area: "printing", code: "agent.silent" })).toBe("printers");
    expect(partOfAlert({ area: "card_reader", code: "reader.battery_low" })).toBe("readers");
    expect(partOfAlert({ area: "backup", code: "backup.stream_behind" })).toBe("bucket");
    expect(partOfAlert({ area: "backup", code: "backup.stream_paused" })).toBe("bucket");
    expect(partOfAlert({ area: "fiscal", code: "fiscal.clock_drift" })).toBe("clock");
    expect(partOfAlert({ area: "box", code: "clock.behind_last_sale" })).toBe("clock");
    expect(partOfAlert({ area: "fiscal", code: "fiscal.submission_delayed" })).toBe("tax");
    expect(partOfAlert({ area: "fiscal", code: "fiscal.awaiting_certificate" })).toBe("tax");
    expect(partOfAlert({ area: "box", code: "storage.space_low" })).toBe("disk");
  });

  it("leaves every other alert off the rows", () => {
    expect(partOfAlert({ area: "kitchen", code: "station.printer_down" })).toBeNull();
    expect(partOfAlert({ area: "backup", code: "backup.destination_failed" })).toBeNull();
    expect(partOfAlert({ area: "invoice_delivery", code: "invoice_delivery.failed" })).toBeNull();
  });
});

describe("partsOfNotice", () => {
  it("names the rows each staff notice colours", () => {
    expect(partsOfNotice("storage.disk_full")).toEqual(["sales", "disk"]);
    expect(partsOfNotice("clock.unusable")).toEqual(["sales", "clock"]);
    expect(partsOfNotice("storage.space_low")).toEqual(["disk"]);
    expect(partsOfNotice("fiscal.records_unsent")).toEqual(["tax"]);
    expect(partsOfNotice("something.new")).toEqual([]);
  });
});

describe("boxStatusRows", () => {
  it("draws a quiet box with every row fine", () => {
    const { rows, other, checksUnavailable } = boxStatusRows(quietHealth(), []);
    expect(rows.map((r) => r.id)).toEqual([
      "sales",
      "tax",
      "bucket",
      "printers",
      "readers",
      "clock",
      "disk",
    ]);
    expect(rows.map((r) => r.state)).toEqual(Array(7).fill("ok"));
    expect(other).toBe(0);
    expect(checksUnavailable).toBe(false);
    expect(row(rows, "sales")).toMatchObject({
      line: t("box_status.sales.ok"),
      details: [fill("box_status.sales.last", { time: formatIsoMinute(LAST_SALE) })],
      alerts: [],
      screen: null,
    });
    expect(row(rows, "tax")).toMatchObject({
      line: t("box_status.tax.ok"),
      details: [],
      screen: null,
    });
    expect(row(rows, "bucket")).toMatchObject({
      line: t("box_status.bucket.ok"),
      details: [fill("box_status.bucket.last", { time: formatIsoMinute(UPLOADED) })],
      screen: "backup",
    });
    expect(row(rows, "printers")).toMatchObject({
      line: t("box_status.no_problems"),
      details: ["Bar"],
      screen: "printers",
    });
    expect(row(rows, "readers")).toMatchObject({
      line: t("box_status.no_problems"),
      details: ["Reader 1"],
      screen: "payments",
    });
    expect(row(rows, "clock")).toMatchObject({
      line: t("box_status.clock.ok"),
      details: [
        fill("box_status.clock.compared", { time: formatIsoMinute(MEASURED), seconds: "2" }),
      ],
      screen: null,
    });
    expect(row(rows, "disk")).toMatchObject({
      line: fill("box_status.disk.free", {
        free: formatBytes(1_800_000_000, "en"),
        total: formatBytes(32_000_000_000, "en"),
      }),
      details: [
        [
          fill("box_status.disk.database", { size: formatBytes(120_000_000, "en") }),
          fill("box_status.disk.backups", { size: formatBytes(300_000_000, "en") }),
          fill("box_status.disk.logs", { size: formatBytes(40_000_000, "en") }),
          fill("box_status.disk.other", { size: formatBytes(29_740_000_000, "en") }),
        ].join(" · "),
      ],
      screen: null,
    });
  });

  it("stops Sales and Disk on a full disk, both worded as the disk", () => {
    const { rows } = boxStatusRows(quietHealth({ notices: [DISK_FULL] }), []);
    expect(row(rows, "sales")).toMatchObject({
      state: "stopped",
      line: t("box_status.notice.disk_full"),
    });
    expect(row(rows, "disk")).toMatchObject({
      state: "stopped",
      line: t("box_status.notice.disk_full"),
    });
    expect(row(rows, "clock").state).toBe("ok");
  });

  it("words Sales as the disk when both reds are on, and stops the Clock with its own words", () => {
    const { rows } = boxStatusRows(quietHealth({ notices: [CLOCK_UNUSABLE, DISK_FULL] }), []);
    expect(row(rows, "sales")).toMatchObject({
      state: "stopped",
      line: t("box_status.notice.disk_full"),
    });
    expect(row(rows, "clock")).toMatchObject({
      state: "stopped",
      line: t("box_status.notice.clock_unusable"),
    });
    expect(row(rows, "disk").state).toBe("stopped");
  });

  it("words Sales as the clock when only the clock is red", () => {
    const { rows } = boxStatusRows(quietHealth({ notices: [CLOCK_UNUSABLE] }), []);
    expect(row(rows, "sales")).toMatchObject({
      state: "stopped",
      line: t("box_status.notice.clock_unusable"),
    });
    expect(row(rows, "disk").state).toBe("ok");
  });

  it("turns Disk amber on low space, keeping its free-of-total line", () => {
    const { rows } = boxStatusRows(
      quietHealth({ notices: [notice("storage.space_low", "warning")] }),
      [],
    );
    expect(row(rows, "disk")).toMatchObject({
      state: "attention",
      line: fill("box_status.disk.free", {
        free: formatBytes(1_800_000_000, "en"),
        total: formatBytes(32_000_000_000, "en"),
      }),
    });
    expect(row(rows, "sales").state).toBe("ok");
  });

  it("counts unsent records on the Tax row, singular for one", () => {
    const many = boxStatusRows(
      quietHealth({ notices: [notice("fiscal.records_unsent", "warning", { count: 12 })] }),
      [],
    ).rows;
    expect(row(many, "tax")).toMatchObject({
      state: "attention",
      line: fill("box_status.tax.unsent", { count: "12" }),
    });
    expect(row(many, "tax").line).toMatch(/^12 records not yet sent · /);
    const one = boxStatusRows(
      quietHealth({ notices: [notice("fiscal.records_unsent", "warning", { count: 1 })] }),
      [],
    ).rows;
    expect(row(one, "tax").line).toBe(t("box_status.tax.unsent_one"));
  });

  it("draws a bell error on a row as amber, never red, with the bell's sentence", () => {
    const stuck = alert("printer.jobs_waiting", "printing", {
      severity: "error",
      params: { count: 3, printer: "Bar" },
    });
    const { rows } = boxStatusRows(quietHealth(), [stuck]);
    expect(row(rows, "printers")).toMatchObject({
      state: "attention",
      line: alertMessage("printer.jobs_waiting", { count: 3, printer: "Bar" }, "en"),
      details: ["Bar"],
      alerts: [stuck],
    });
  });

  it("turns Clock, Tax and Bucket amber on their own alerts", () => {
    const drift = alert("fiscal.clock_drift", "fiscal", { params: { seconds: 90 } });
    const delayed = alert("fiscal.submission_delayed", "fiscal", {
      params: { count: 4, hours: 5 },
    });
    const behind = alert("backup.stream_behind", "backup", { params: { minutes: 20 } });
    const { rows, other } = boxStatusRows(quietHealth(), [drift, delayed, behind]);
    expect(row(rows, "clock")).toMatchObject({
      state: "attention",
      line: alertMessage("fiscal.clock_drift", { seconds: 90 }, "en"),
      alerts: [drift],
    });
    expect(row(rows, "tax")).toMatchObject({
      state: "attention",
      line: alertMessage("fiscal.submission_delayed", { count: 4, hours: 5 }, "en"),
      alerts: [delayed],
    });
    expect(row(rows, "bucket")).toMatchObject({ state: "attention", alerts: [behind] });
    expect(other).toBe(0);
  });

  it("keeps a row's notice line over its alert's sentence, listing the alerts in the bell's order", () => {
    const first = alert("fiscal.submission_delayed", "fiscal", { key: "a" });
    const second = alert("fiscal.awaiting_certificate", "fiscal", { key: "b" });
    const { rows } = boxStatusRows(
      quietHealth({ notices: [notice("fiscal.records_unsent", "warning", { count: 2 })] }),
      [first, second],
    );
    expect(row(rows, "tax")).toMatchObject({
      state: "attention",
      line: fill("box_status.tax.unsent", { count: "2" }),
      alerts: [first, second],
    });
  });

  it("counts unmapped alerts and unknown notices on the other line", () => {
    const { other } = boxStatusRows(quietHealth({ notices: [notice("x.unknown", "warning")] }), [
      alert("station.printer_down", "kitchen"),
      alert("invoice_delivery.failed", "invoice_delivery"),
    ]);
    expect(other).toBe(3);
  });

  it("says when some checks could not be made", () => {
    expect(boxStatusRows(quietHealth({ noticesUnavailable: ["x"] }), []).checksUnavailable).toBe(
      true,
    );
  });

  it("words the parts a box does not have", () => {
    const { rows } = boxStatusRows(
      quietHealth({ filing: false, printers: [], readers: [], stream: { state: "off" } }),
      [],
    );
    expect(row(rows, "tax")).toMatchObject({ state: "ok", line: t("box_status.tax.not_filing") });
    expect(row(rows, "printers")).toMatchObject({
      line: t("box_status.printers.none"),
      details: [],
    });
    expect(row(rows, "readers")).toMatchObject({ line: t("box_status.readers.none"), details: [] });
    expect(row(rows, "bucket")).toMatchObject({ line: t("box_status.bucket.off"), details: [] });
  });

  it("leaves out the Card readers row with payments off, counting its alerts as other", () => {
    const battery = alert("reader.battery_low", "card_reader");
    const { rows, other } = boxStatusRows(quietHealth({ readers: null }), [battery]);
    expect(rows.map((r) => r.id)).not.toContain("readers");
    expect(rows).toHaveLength(6);
    expect(other).toBe(1);
  });

  it("names the printers and readers set up, joined", () => {
    const { rows } = boxStatusRows(
      quietHealth({
        printers: [
          { id: "p1", name: "Bar" },
          { id: "p2", name: "Invoices" },
        ],
        readers: [
          { id: "r1", name: "Reader 1" },
          { id: "r2", name: "Reader 2" },
        ],
      }),
      [],
    );
    expect(row(rows, "printers").details).toEqual(["Bar, Invoices"]);
    expect(row(rows, "readers").details).toEqual(["Reader 1, Reader 2"]);
  });

  it("words each state of the bucket copy", () => {
    const base = {
      generation: null,
      reason: null,
      stateSince: "2026-10-22T08:00:00.000Z",
      bucketProblem: null,
      lastConfirmedUploadAt: null,
    };
    const line = (stream: BoxHealth["stream"]) =>
      row(boxStatusRows(quietHealth({ stream }), []).rows, "bucket");
    expect(line({ ...base, state: "opening", lagMs: 0 })).toMatchObject({
      line: t("box_status.bucket.starting"),
      details: [],
    });
    expect(line({ ...base, state: "streaming", lagMs: 59_999 }).line).toBe(
      t("box_status.bucket.ok"),
    );
    expect(line({ ...base, state: "streaming", lagMs: 60_000 }).line).toBe(
      fill("box_status.bucket.behind", { minutes: "1" }),
    );
    expect(line({ ...base, state: "streaming", lagMs: 179_999 }).line).toBe(
      fill("box_status.bucket.behind", { minutes: "2" }),
    );
    expect(line({ ...base, state: "paused", lagMs: 0 }).line).toBe(
      t("box_status.bucket.not_copying"),
    );
    expect(line({ ...base, state: "refused", lagMs: 0 }).line).toBe(
      t("box_status.bucket.not_copying"),
    );
    expect(line({ ...base, state: "off", lagMs: 0 }).line).toBe(t("box_status.bucket.not_copying"));
    expect(
      line({ state: "off", reason: "settings.unusable", stateSince: base.stateSince }).line,
    ).toBe(t("box_status.bucket.not_copying"));
  });

  it("words a box whose disk cannot be measured, with no details", () => {
    const { rows } = boxStatusRows(
      quietHealth({
        disk: {
          freeBytes: null,
          totalBytes: null,
          databaseBytes: null,
          backupsBytes: null,
          logBytes: null,
          otherBytes: null,
          stoppedSince: null,
          lowSince: null,
          reclaimable: { bytes: 0, backupRunning: false },
        },
      }),
      [],
    );
    expect(row(rows, "disk")).toMatchObject({
      line: t("box_status.disk.unreadable"),
      details: [],
    });
  });

  it("leaves out the disk parts it cannot read", () => {
    const health = quietHealth();
    const { rows } = boxStatusRows(
      quietHealth({ disk: { ...health.disk, databaseBytes: null, otherBytes: null } }),
      [],
    );
    expect(row(rows, "disk").details).toEqual([
      [
        fill("box_status.disk.backups", { size: formatBytes(300_000_000, "en") }),
        fill("box_status.disk.logs", { size: formatBytes(40_000_000, "en") }),
      ].join(" · "),
    ]);
  });

  it("words a box with no sales yet, and a clock never compared", () => {
    const { rows } = boxStatusRows(
      quietHealth({
        sales: { lastAt: null },
        clock: {
          authority: { state: "unknown" },
          sync: { synced: false, source: "unavailable", warn: false },
        },
      }),
      [],
    );
    expect(row(rows, "sales").details).toEqual([t("box_status.sales.none")]);
    expect(row(rows, "clock")).toMatchObject({
      line: t("box_status.clock.unknown"),
      details: [],
    });
  });

  it("reads the Spanish words in Spanish", () => {
    setLocale("es");
    const quiet = boxStatusRows(quietHealth(), []).rows;
    expect(row(quiet, "sales")).toMatchObject({
      line: t("box_status.sales.ok"),
      details: [fill("box_status.sales.last", { time: formatIsoMinute(LAST_SALE) })],
    });
    expect(row(quiet, "sales").line).toBe(es["box_status.sales.ok"]);
    expect(row(quiet, "tax").line).toBe(t("box_status.tax.ok"));
    expect(row(quiet, "clock").line).toBe(t("box_status.clock.ok"));
    expect(row(quiet, "disk").line).toBe(
      fill("box_status.disk.free", {
        free: formatBytes(1_800_000_000, "es"),
        total: formatBytes(32_000_000_000, "es"),
      }),
    );
    const unsent = boxStatusRows(
      quietHealth({ notices: [notice("fiscal.records_unsent", "warning", { count: 12 })] }),
      [],
    ).rows;
    expect(row(unsent, "tax").line).toBe(fill("box_status.tax.unsent", { count: "12" }));
    setLocale("en");
    expect(row(unsent, "tax").line).not.toBe(fill("box_status.tax.unsent", { count: "12" }));
  });

  it("says whether the clock keeps internet time only when the box can tell", () => {
    const withSync = (sync: BoxHealth["clock"]["sync"]) =>
      row(
        boxStatusRows(
          quietHealth({
            clock: {
              authority: { state: "ok", driftSeconds: 0, measuredAt: MEASURED },
              sync,
            },
          }),
          [],
        ).rows,
        "clock",
      ).details;
    expect(withSync({ source: "timedatectl", synced: true, warn: false })).toContain(
      t("box_status.clock.synced"),
    );
    expect(withSync({ source: "timedatectl", synced: false, warn: true })).toContain(
      t("box_status.clock.not_synced"),
    );
    const silent = withSync({ source: "unavailable", synced: false, warn: false });
    expect(silent).not.toContain(t("box_status.clock.synced"));
    expect(silent).not.toContain(t("box_status.clock.not_synced"));
    expect(silent).toHaveLength(1);
  });

  it("turns Card readers amber on a battery alert, with its sentence", () => {
    const battery = alert("reader.battery_low", "card_reader", {
      params: { reader: "Reader 1", percent: 12 },
    });
    const { rows, other } = boxStatusRows(quietHealth(), [battery]);
    expect(row(rows, "readers")).toMatchObject({
      state: "attention",
      line: alertMessage("reader.battery_low", { reader: "Reader 1", percent: 12 }, "en"),
      details: ["Reader 1"],
      alerts: [battery],
    });
    expect(other).toBe(0);
  });
});
