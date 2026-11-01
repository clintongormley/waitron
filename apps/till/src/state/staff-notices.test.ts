import { describe, expect, it } from "vitest";
import type { DeviceEquipmentRead, StaffNotice } from "../api/client.js";
import { checkTimeOffered, nextNotices } from "./staff-notices.js";

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

  it("lists a notice once when the read sends it fresh from an owner it also names unavailable", () => {
    const clock = notice("fiscal", "clock");
    const unsent = notice("fiscal", "unsent");
    expect(
      nextNotices([clock, unsent], read({ notices: [clock], noticesUnavailable: ["fiscal"] })),
    ).toEqual([clock, unsent]);
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

describe("the box's check-the-time marker", () => {
  const marker: StaffNotice = {
    owner: "box-clock",
    key: "clock.check_time",
    code: "clock.check_time",
    severity: "error",
    params: {},
  };
  const behind: StaffNotice = {
    owner: "fiscal",
    key: "clock.behind_chain",
    code: "clock.behind_chain",
    severity: "error",
    params: {},
  };

  it("is offered, and left out of the notices shown, when the read carries it", () => {
    const withMarker = read({ notices: [marker, behind] });
    expect(nextNotices([], withMarker)).toEqual([behind]);
    expect(checkTimeOffered(withMarker, false)).toBe(true);
  });

  it("is not offered when the read does not carry it, and the notices are as before", () => {
    const without = read({ notices: [behind] });
    expect(nextNotices([], without)).toEqual([behind]);
    expect(checkTimeOffered(without, false)).toBe(false);
    expect(checkTimeOffered(read(), false)).toBe(false);
  });

  it("keeps the earlier answer while a read names the box's clock owner unavailable", () => {
    const blind = read({ notices: [behind], noticesUnavailable: ["box-clock"] });
    expect(checkTimeOffered(blind, true)).toBe(true);
    expect(checkTimeOffered(blind, false)).toBe(false);
    expect(checkTimeOffered(read({ notices: [behind] }), true)).toBe(false);
    expect(
      checkTimeOffered(read({ notices: [behind], noticesUnavailable: ["fiscal"] }), true),
    ).toBe(false);
  });

  it("is not offered by a marker that is not well formed", () => {
    const broken = { ...marker, params: null } as unknown as StaffNotice;
    expect(checkTimeOffered(read({ notices: [broken] }), false)).toBe(false);
  });
});
