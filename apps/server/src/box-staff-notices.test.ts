import { describe, expect, it } from "vitest";
import type { StaffNoticeReadContext } from "@waitron/module";
import { BOX_NOTICE_OWNER, boxStaffNoticeSource } from "./box-staff-notices.js";
import type { FreeSpaceReading } from "./free-space-watch.js";

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
