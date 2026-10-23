import { describe, expect, it, vi } from "vitest";
import type { StaffNoticeReadContext } from "@waitron/module";
import {
  BOX_NOTICE_OWNER,
  boxStaffNoticeSource,
  devicePrinterNoticeSources,
  printerStaffNoticeSource,
} from "./box-staff-notices.js";
import type { FreeSpaceReading } from "./free-space-watch.js";
import type { PrinterInTrouble } from "./print-job-trouble.js";

const AT = new Date("2026-10-22T10:00:00.000Z");
const CTX = {
  tx: {} as StaffNoticeReadContext["tx"],
  reading: { instant: AT, offsetMinutes: 120 },
} satisfies StaffNoticeReadContext;

const DISK_FULL = {
  key: "storage.disk_full",
  code: "storage.disk_full",
  severity: "error",
  params: {},
};
const SPACE_LOW = {
  key: "storage.space_low",
  code: "storage.space_low",
  severity: "warning",
  params: {},
};

function read(since: Date | null, reading: FreeSpaceReading) {
  return boxStaffNoticeSource({
    disk: { since: () => since },
    space: { current: () => reading },
  }).read(CTX);
}

const OFF: FreeSpaceReading = { freeBytes: 10 * 1024 ** 3, readAt: AT, lowSince: null };
const ON: FreeSpaceReading = { freeBytes: 1024, readAt: AT, lowSince: AT };

describe("boxStaffNoticeSource", () => {
  it("is owned by the box", () => {
    expect(BOX_NOTICE_OWNER).toBe("box");
  });

  it("answers nothing while no stop is noted and the warning is off", async () => {
    expect(await read(null, OFF)).toEqual([]);
  });

  it("answers the low-space notice while the warning is on", async () => {
    expect(await read(null, ON)).toEqual([SPACE_LOW]);
  });

  it("answers the full-disk notice while the stop is noted", async () => {
    expect(await read(AT, OFF)).toEqual([DISK_FULL]);
  });

  it("answers only the full-disk notice while the stop is noted and the warning is on", async () => {
    expect(await read(AT, ON)).toEqual([DISK_FULL]);
  });

  it("answers nothing before the first reading", async () => {
    expect(await read(null, { freeBytes: null, readAt: null, lowSince: null })).toEqual([]);
  });
});

describe("printer notices", () => {
  const row = (over: Partial<PrinterInTrouble> & { id: string }): PrinterInTrouble => ({
    name: "Kitchen",
    count: 1,
    oldest: "2026-10-22T09:50:00.000Z",
    stuckSince: "2026-10-22T09:55:00.000Z",
    kitchen: true,
    ...over,
  });
  const jobsWaiting = (id: string, printer: string, since: string) => ({
    key: `printer.jobs_waiting:${id}`,
    code: "printer.jobs_waiting",
    severity: "warning",
    params: { printer, since },
  });

  it("a stuck kitchen printer shows on any device, without reading the device's printers", async () => {
    const trouble = vi.fn(() => Promise.resolve([row({ id: "k" })]));
    const documentPrinters = vi.fn();
    const source = printerStaffNoticeSource({ deviceId: "d1", trouble, documentPrinters });
    expect(await source.read(CTX)).toEqual([
      jobsWaiting("k", "Kitchen", "2026-10-22T09:55:00.000Z"),
    ]);
    expect(documentPrinters).not.toHaveBeenCalled();
    expect(trouble).toHaveBeenCalledWith(CTX.tx, AT);
  });

  it("a printer in trouble that has printed since shows nothing", async () => {
    const source = printerStaffNoticeSource({
      deviceId: "d1",
      trouble: () => Promise.resolve([row({ id: "k", stuckSince: null })]),
      documentPrinters: vi.fn(),
    });
    expect(await source.read(CTX)).toEqual([]);
  });

  it("another printer shows only on a device that prints its documents to it", async () => {
    const documentPrinters = vi.fn(() => Promise.resolve(new Set(["p2"])));
    const source = printerStaffNoticeSource({
      deviceId: "d1",
      trouble: () =>
        Promise.resolve([
          row({ id: "p1", name: "Bar", kitchen: false }),
          row({ id: "p2", name: "Terrace", kitchen: false }),
        ]),
      documentPrinters,
    });
    expect(await source.read(CTX)).toEqual([
      jobsWaiting("p2", "Terrace", "2026-10-22T09:55:00.000Z"),
    ]);
    expect(documentPrinters).toHaveBeenCalledWith(CTX.tx, "d1");
  });

  it("orders the notices by when they got stuck, then by name", async () => {
    const source = printerStaffNoticeSource({
      deviceId: "d1",
      trouble: () =>
        Promise.resolve([
          row({ id: "late", name: "Alpha", stuckSince: "2026-10-22T09:58:00.000Z" }),
          row({ id: "b", name: "Bar", stuckSince: "2026-10-22T09:52:00.000Z" }),
          row({ id: "a", name: "Alpha", stuckSince: "2026-10-22T09:52:00.000Z" }),
        ]),
      documentPrinters: vi.fn(),
    });
    expect((await source.read(CTX)).map((n) => n.key)).toEqual([
      "printer.jobs_waiting:a",
      "printer.jobs_waiting:b",
      "printer.jobs_waiting:late",
    ]);
  });

  it("no printer in trouble shows nothing and reads no device printers", async () => {
    const documentPrinters = vi.fn();
    const source = printerStaffNoticeSource({
      deviceId: "d1",
      trouble: () => Promise.resolve([]),
      documentPrinters,
    });
    expect(await source.read(CTX)).toEqual([]);
    expect(documentPrinters).not.toHaveBeenCalled();
  });

  it("devices share one read for ten seconds, then read again", async () => {
    let now = AT;
    const trouble = vi.fn(() => Promise.resolve([row({ id: "k" })]));
    const sources = devicePrinterNoticeSources({
      now: () => now,
      locationId: "loc",
      trouble,
      documentPrinters: async () => new Set(),
    });
    const one = sources("d1");
    const two = sources("d2");
    expect([...one, ...two].map((s) => s.owner)).toEqual(["printers", "printers"]);
    await one[0]!.source.read(CTX);
    await two[0]!.source.read(CTX);
    expect(trouble).toHaveBeenCalledTimes(1);
    expect(trouble).toHaveBeenCalledWith(CTX.tx, AT, { locationId: "loc" });
    now = new Date(AT.getTime() + 9_999);
    await two[0]!.source.read(CTX);
    expect(trouble).toHaveBeenCalledTimes(1);
    now = new Date(AT.getTime() + 10_000);
    await one[0]!.source.read(CTX);
    expect(trouble).toHaveBeenCalledTimes(2);
  });
});
