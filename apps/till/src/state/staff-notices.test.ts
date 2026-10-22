import { describe, expect, it } from "vitest";
import type { DeviceEquipmentRead, StaffNotice } from "../api/client.js";
import { nextNotices } from "./staff-notices.js";

const notice = (
  owner: string,
  key: string,
  severity: StaffNotice["severity"] = "warning",
): StaffNotice => ({ owner, key, code: `${owner}.${key}`, severity, params: {} });

const read = (fields: Partial<DeviceEquipmentRead> = {}): DeviceEquipmentRead => ({
  roles: [],
  ...fields,
});

describe("the notices an equipment read leaves shown", () => {
  it("replaces whatever was before with the read's notices", () => {
    const fresh = notice("box", "clock");
    expect(
      nextNotices([notice("box", "disk"), notice("fiscal", "waiting")], read({ notices: [fresh] })),
    ).toEqual([fresh]);
  });

  it("shows nothing after a read with no notices key", () => {
    expect(nextNotices([notice("box", "disk")], read())).toEqual([]);
  });

  it("keeps the previous notices of an owner named unavailable, and only that owner's", () => {
    const kept = notice("fiscal", "waiting");
    expect(
      nextNotices(
        [notice("box", "disk"), kept],
        read({ notices: [], noticesUnavailable: ["fiscal"] }),
      ),
    ).toEqual([kept]);
  });

  it("keeps nothing for an unavailable owner that had nothing before", () => {
    expect(
      nextNotices([notice("box", "disk")], read({ notices: [], noticesUnavailable: ["fiscal"] })),
    ).toEqual([]);
  });

  it("orders kept and fresh notices by severity, fresh before kept within one", () => {
    const keptWarning = notice("fiscal", "waiting", "warning");
    const keptError = notice("fiscal", "refused", "error");
    const freshNotice = notice("box", "update", "notice");
    const freshWarning = notice("box", "clock", "warning");
    const freshError = notice("box", "disk", "error");
    expect(
      nextNotices(
        [keptWarning, keptError],
        read({
          notices: [freshNotice, freshWarning, freshError],
          noticesUnavailable: ["fiscal"],
        }),
      ),
    ).toEqual([freshError, keptError, freshWarning, keptWarning, freshNotice]);
  });

  it("drops entries that are not well formed and counts an unknown severity as a notice", () => {
    const good = notice("box", "disk", "error");
    const without = (field: keyof StaffNotice, key: string) => {
      const entry: Partial<StaffNotice> = notice("box", key);
      delete entry[field];
      return entry;
    };
    const noCode = without("code", "a");
    const noKey = without("key", "b");
    const noOwner = without("owner", "c");
    const listParams = { ...notice("box", "d"), params: [] };
    const nullParams = { ...notice("box", "e"), params: null };
    const textParams = { ...notice("box", "f"), params: "x" };
    const purple = { ...notice("box", "g"), severity: "purple" };
    const notices = [
      noCode,
      noKey,
      noOwner,
      listParams,
      nullParams,
      textParams,
      null,
      purple,
      good,
    ];
    expect(nextNotices([], read({ notices: notices as unknown as StaffNotice[] }))).toEqual([
      good,
      { ...purple, severity: "notice" },
    ]);
  });
});
