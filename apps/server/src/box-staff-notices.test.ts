import { describe, expect, it, vi } from "vitest";
import type { ClockWitness } from "@waitron/fiscal";
import type { StaffNoticeReadContext } from "@waitron/module";
import {
  BOX_CLOCK_NOTICE_OWNER,
  BOX_NOTICE_OWNER,
  boxStaffNoticeSource,
  clockCheckNoticeSource,
  DEVICE_CLOCK_NOTICE_OWNER,
  deviceClockNoticeSource,
  deviceNoticeSources,
  devicePrinterNoticeSources,
  printerStaffNoticeSource,
} from "./box-staff-notices.js";
import { FULL_DISK_BYTES } from "./boot-failure.js";
import { createDiskFullState } from "./disk-full-state.js";
import type { Statfs } from "./free-bytes.js";
import type { FreeSpaceReading } from "./free-space-watch.js";
import type { PrinterInTrouble } from "./print-job-trouble.js";
import { ALL_MODULES } from "./modules.js";
import { clockServiceAnswer } from "./testing/synchronised-box-host.js";
import { readStaffNotices } from "./staff-notices.js";

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

/** `full` stands in for the payment paths' fresh look at the disk; by default the disk is still
 * full while the stop is noted. */
async function read(since: Date | null, reading: FreeSpaceReading, full = since !== null) {
  const source = await boxStaffNoticeSource({
    disk: { since: () => since, full: () => Promise.resolve(full) },
    space: { current: () => reading },
  });
  return source.read(CTX);
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

  it("answers no full-disk notice while the stop is noted but the payment paths' look finds space back", async () => {
    expect(await read(AT, OFF, false)).toEqual([]);
    expect(await read(AT, ON, false)).toEqual([SPACE_LOW]);
  });

  it("does not look at the disk while no stop is noted", async () => {
    const full = vi.fn(() => Promise.resolve(true));
    const source = await boxStaffNoticeSource({
      disk: { since: () => null, full },
      space: { current: () => OFF },
    });
    expect(await source.read(CTX)).toEqual([]);
    expect(full).not.toHaveBeenCalled();
  });

  it("fails its read, not its making, when the look at the disk fails", async () => {
    const source = boxStaffNoticeSource({
      disk: { since: () => AT, full: () => Promise.reject(new Error("EIO")) },
      space: { current: () => ON },
    });
    await expect((await source).read(CTX)).rejects.toThrow("EIO");
  });

  it("looks at the disk when made, and answers what it found then", async () => {
    let full = true;
    const look = vi.fn(() => Promise.resolve(full));
    const source = await boxStaffNoticeSource({
      disk: { since: () => AT, full: look },
      space: { current: () => OFF },
    });
    expect(look).toHaveBeenCalledOnce();
    full = false;
    expect(await source.read(CTX)).toEqual([DISK_FULL]);
    expect(look).toHaveBeenCalledOnce();
  });

  describe("with the real stop", () => {
    function noted(statfs: Statfs) {
      const disk = createDiskFullState({ dir: "/venue", now: () => AT, log: () => {}, statfs });
      disk.noteRefused();
      return disk;
    }
    const readOn = async (disk: ReturnType<typeof noted>) =>
      (await boxStaffNoticeSource({ disk, space: { current: () => OFF } })).read(CTX);

    it("answers the full-disk notice while the disk is still full", async () => {
      const disk = noted(async () => ({ bavail: FULL_DISK_BYTES - 1, frsize: 1 }));
      expect(await readOn(disk)).toEqual([DISK_FULL]);
      expect(disk.since()).toEqual(AT);
    });

    it("answers the full-disk notice while the disk cannot be read", async () => {
      const disk = noted(async () => {
        throw new Error("EIO");
      });
      expect(await readOn(disk)).toEqual([DISK_FULL]);
      expect(disk.since()).toEqual(AT);
    });

    it("answers nothing, and clears the stop, once space is back", async () => {
      const disk = noted(async () => ({ bavail: FULL_DISK_BYTES, frsize: 1 }));
      expect(await readOn(disk)).toEqual([]);
      expect(disk.since()).toBeNull();
    });
  });
});

describe("the till's clock check", () => {
  const CHECK_TIME = {
    key: "clock.check_time",
    code: "clock.check_time",
    severity: "error",
    params: {},
  };

  /** Runs each source's savepoint straight through. */
  const SAVEPOINTS = {
    transaction: (fn: () => Promise<unknown>) => fn(),
  } as unknown as StaffNoticeReadContext["tx"];

  it("has an owner of its own, which no module is named", () => {
    expect(BOX_CLOCK_NOTICE_OWNER).toBe("box-clock");
    expect(ALL_MODULES.map((module) => module.name)).not.toContain(BOX_CLOCK_NOTICE_OWNER);
  });

  it("answers the check-the-time marker while the check answers true, asking at the read's reading", async () => {
    const clockCheck = vi.fn(async () => true);
    expect(await clockCheckNoticeSource(clockCheck).read(CTX)).toEqual([CHECK_TIME]);
    expect(clockCheck).toHaveBeenCalledExactlyOnceWith(CTX.tx, CTX.reading);
  });

  it("answers the waiting notice with its count in place of the marker while the start check waits", async () => {
    const source = clockCheckNoticeSource(
      async () => true,
      () => ({ agreed: 1, cause: "start" }),
    );
    expect(await source.read(CTX)).toEqual([
      {
        key: "clock.unconfirmed",
        code: "clock.unconfirmed",
        severity: "error",
        params: { agreed: 1, cause: "start" },
      },
    ]);
  });

  it("answers the marker when the start check does not wait, and nothing when the check answers false", async () => {
    expect(
      await clockCheckNoticeSource(
        async () => true,
        () => null,
      ).read(CTX),
    ).toEqual([CHECK_TIME]);
    expect(
      await clockCheckNoticeSource(
        async () => false,
        () => ({ agreed: 0, cause: "start" }),
      ).read(CTX),
    ).toEqual([]);
  });

  it("is given the waiting count and why the box waits by the device sources", async () => {
    const sources = deviceNoticeSources(
      {
        disk: { since: () => null, full: () => Promise.resolve(false) },
        space: { current: () => OFF },
        clockCheck: async () => true,
        startClockWaits: () => ({ agreed: 0, cause: "clock_jumped" }),
      },
      [],
    );
    const read = await readStaffNotices(SAVEPOINTS, await sources(), {
      reading: CTX.reading,
      log: () => {},
    });
    expect(read.notices).toEqual([
      {
        key: "clock.unconfirmed",
        code: "clock.unconfirmed",
        severity: "error",
        params: { agreed: 0, cause: "clock_jumped" },
        owner: BOX_CLOCK_NOTICE_OWNER,
      },
    ]);
  });

  it("answers no marker while the check answers false", async () => {
    expect(await clockCheckNoticeSource(async () => false).read(CTX)).toEqual([]);
  });

  it("is a device source only when a check is given, after the box's own", async () => {
    const box = {
      disk: { since: () => null, full: () => Promise.resolve(false) },
      space: { current: () => OFF },
    };
    const owners = async (sources: ReturnType<typeof deviceNoticeSources>) =>
      (await sources()).map((entry) => entry.owner);
    expect(await owners(deviceNoticeSources(box, []))).toEqual([BOX_NOTICE_OWNER]);
    expect(await owners(deviceNoticeSources({ ...box, clockCheck: async () => true }, []))).toEqual(
      [BOX_NOTICE_OWNER, BOX_CLOCK_NOTICE_OWNER],
    );
  });

  it("keeps the storage notices when the check's read fails", async () => {
    const sources = deviceNoticeSources(
      {
        disk: { since: () => AT, full: () => Promise.resolve(true) },
        space: { current: () => OFF },
        clockCheck: async () => {
          throw new Error("database is locked");
        },
      },
      [],
    );
    const read = await readStaffNotices(SAVEPOINTS, await sources(), {
      reading: CTX.reading,
      log: () => {},
    });
    expect(read.notices).toEqual([{ ...DISK_FULL, owner: BOX_NOTICE_OWNER }]);
    expect(read.unavailable).toEqual([BOX_CLOCK_NOTICE_OWNER]);
  });

  it("is read beside the storage notices", async () => {
    const sources = deviceNoticeSources(
      {
        disk: { since: () => null, full: () => Promise.resolve(false) },
        space: { current: () => ON },
        clockCheck: async () => true,
      },
      [],
    );
    const read = await readStaffNotices(SAVEPOINTS, await sources(), {
      reading: CTX.reading,
      log: () => {},
    });
    expect(read.notices).toEqual([
      { ...CHECK_TIME, owner: BOX_CLOCK_NOTICE_OWNER },
      { ...SPACE_LOW, owner: BOX_NOTICE_OWNER },
    ]);
  });
});

describe("printer notices", () => {
  const row = (over: Partial<PrinterInTrouble> & { id: string }): PrinterInTrouble => ({
    name: "Kitchen",
    count: 1,
    oldest: "2026-10-22T09:50:00.000Z",
    stuckSince: "2026-10-22T09:55:00.000Z",
    givenUp: false,
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

  it("a printer in trouble that has printed since asks for the failed ticket to be reprinted", async () => {
    const source = printerStaffNoticeSource({
      deviceId: "d1",
      trouble: () => Promise.resolve([row({ id: "k", stuckSince: null, givenUp: true })]),
      documentPrinters: vi.fn(),
    });
    expect(await source.read(CTX)).toEqual([
      {
        key: "printer.ticket_failed:k",
        code: "printer.ticket_failed",
        severity: "warning",
        params: { printer: "Kitchen" },
      },
    ]);
  });

  it("a printer that has printed since, with no ticket given up, shows nothing", async () => {
    const source = printerStaffNoticeSource({
      deviceId: "d1",
      trouble: () => Promise.resolve([row({ id: "k", stuckSince: null, givenUp: false })]),
      documentPrinters: vi.fn(),
    });
    expect(await source.read(CTX)).toEqual([]);
  });

  it("another printer's failed ticket shows only on a device that prints its documents to it", async () => {
    const documentPrinters = vi.fn(() => Promise.resolve(new Set(["p2"])));
    const source = printerStaffNoticeSource({
      deviceId: "d1",
      trouble: () =>
        Promise.resolve([
          row({ id: "p1", name: "Bar", kitchen: false, stuckSince: null, givenUp: true }),
          row({ id: "p2", name: "Terrace", kitchen: false, stuckSince: null, givenUp: true }),
        ]),
      documentPrinters,
    });
    expect(await source.read(CTX)).toEqual([
      {
        key: "printer.ticket_failed:p2",
        code: "printer.ticket_failed",
        severity: "warning",
        params: { printer: "Terrace" },
      },
    ]);
    expect(documentPrinters).toHaveBeenCalledWith(CTX.tx, "d1");
  });

  it("orders a failed ticket's notice by its oldest job among the stuck ones", async () => {
    const source = printerStaffNoticeSource({
      deviceId: "d1",
      trouble: () =>
        Promise.resolve([
          row({ id: "stuck", name: "Bar", stuckSince: "2026-10-22T09:55:00.000Z" }),
          row({
            id: "later",
            name: "Alpha",
            oldest: "2026-10-22T09:58:00.000Z",
            stuckSince: null,
            givenUp: true,
          }),
          row({
            id: "early",
            name: "Zed",
            oldest: "2026-10-22T09:50:00.000Z",
            stuckSince: null,
            givenUp: true,
          }),
        ]),
      documentPrinters: vi.fn(),
    });
    expect((await source.read(CTX)).map((n) => n.key)).toEqual([
      "printer.ticket_failed:early",
      "printer.jobs_waiting:stuck",
      "printer.ticket_failed:later",
    ]);
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
      trouble,
      documentPrinters: async () => new Set(),
    });
    const one = sources("d1");
    const two = sources("d2");
    expect([...one, ...two].map((s) => s.owner)).toEqual([
      "printers",
      "drawers",
      "printers",
      "drawers",
    ]);
    await one[0]!.source.read(CTX);
    await two[0]!.source.read(CTX);
    expect(trouble).toHaveBeenCalledTimes(1);
    expect(trouble).toHaveBeenCalledWith(CTX.tx, AT);
    now = new Date(AT.getTime() + 9_999);
    await two[0]!.source.read(CTX);
    expect(trouble).toHaveBeenCalledTimes(1);
    now = new Date(AT.getTime() + 10_000);
    await one[0]!.source.read(CTX);
    expect(trouble).toHaveBeenCalledTimes(2);
  });
});

describe("this device's own clock", () => {
  it("has an owner of its own, which no module is named", () => {
    expect(DEVICE_CLOCK_NOTICE_OWNER).toBe("device-clock");
    expect(ALL_MODULES.map((module) => module.name)).not.toContain(DEVICE_CLOCK_NOTICE_OWNER);
  });

  const witness = (id: string, differenceMs: number) => ({
    id,
    boxAt: AT.toISOString(),
    witnessAt: new Date(AT.getTime() + differenceMs).toISOString(),
    uncertaintyMs: 0,
  });
  const WITNESSES = [witness("till-a", 60_001), witness("till-b", 60_000)];
  const lookUp = (witnesses: readonly ClockWitness[]) => (id: string) =>
    witnesses.find((w) => w.id === id);
  const SYNCED = clockServiceAnswer(true);
  const status = () => Promise.resolve(SYNCED);
  const WRONG = {
    key: "clock.device_wrong",
    code: "clock.device_wrong",
    severity: "warning",
    params: {},
  };

  it.each([
    { name: "more than a minute off", witnesses: WITNESSES, id: "till-a", expected: [WRONG] },
    { name: "exactly a minute off", witnesses: WITNESSES, id: "till-b", expected: [] },
    { name: "with no reading", witnesses: WITNESSES, id: "till-c", expected: [] },
    {
      name: "off in the other direction",
      witnesses: [witness("till-a", -3_600_000)],
      id: "till-a",
      expected: [WRONG],
    },
  ])(
    "tells a device $name what the box's synchronised time service makes of it",
    async ({ witnesses, id, expected }) => {
      const off = await deviceClockNoticeSource({ witness: lookUp(witnesses), status }, id);
      expect(off.owner).toBe(DEVICE_CLOCK_NOTICE_OWNER);
      expect(await off.source.read(CTX)).toEqual(expected);
    },
  );

  it("tells nobody while the time service is not synchronised or does not answer", async () => {
    for (const status of [
      () => Promise.resolve({ ...SYNCED, synchronised: false }),
      () => Promise.resolve({ ...SYNCED, service: "off" as const, synchronised: false }),
      () => Promise.resolve({ available: false as const, reason: "missing" as const }),
      () => Promise.reject(new Error("host gone")),
    ]) {
      const off = await deviceClockNoticeSource({ witness: lookUp(WITNESSES), status }, "till-a");
      expect(await off.source.read(CTX)).toEqual([]);
    }
  });

  it("judges synchronised as the start check does, whatever the service reports", async () => {
    for (const service of ["off", "stopped"] as const) {
      const off = await deviceClockNoticeSource(
        { witness: lookUp(WITNESSES), status: () => Promise.resolve({ ...SYNCED, service }) },
        "till-a",
      );
      expect(await off.source.read(CTX)).toEqual([WRONG]);
    }
  });

  it("a failing look at the readings fails only the source's own read", async () => {
    const failing = new Error("witnesses gone");
    const source = await deviceClockNoticeSource(
      {
        witness: () => {
          throw failing;
        },
        status,
      },
      "till-a",
    );
    await expect(source.source.read(CTX)).rejects.toBe(failing);
  });
});
