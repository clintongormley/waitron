import { describe, expect, it } from "vitest";
import { ZoneMenuMemory, type ZoneMenuIdentity } from "./zone-menu-memory.js";
import type { TillZoneMenu } from "../api/client.js";
import { HOME_DISPLAY_DEFAULTS } from "@waitron/catalogue/src/device-home.js";

const identity: ZoneMenuIdentity = {
  origin: "https://venue.example",
  deviceId: "till-a",
  profileId: "bar",
  zoneId: "counter",
};
const lunch = '["restaurant","2026-10-17","lunch","12:00"]';
const menu = (id: string, orderable = true): TillZoneMenu => ({
  id,
  name: id,
  isDefault: id === "lunch",
  orderable,
  sendable: true,
  audience: "customer",
  versionId: "v1",
  structure: { members: [] },
  home: { shortcuts: [], ...HOME_DISPLAY_DEFAULTS },
});
const menus = [menu("lunch"), menu("drinks")];

function storage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
}

describe("zone menu memory", () => {
  it("retains each zone's manual menu across browser restarts without recording an operator", () => {
    const saved = storage();
    const memory = new ZoneMenuMemory(saved);
    memory.remember(identity, lunch, "drinks");
    const terrace = { ...identity, zoneId: "terrace" };
    expect(memory.resolve(terrace, lunch, menus, "lunch")).toBe("lunch");
    memory.remember(terrace, lunch, "lunch");
    const restarted = new ZoneMenuMemory(saved);
    expect(restarted.resolve(identity, lunch, menus, "lunch")).toBe("drinks");
    expect(restarted.resolve(terrace, lunch, menus, "drinks")).toBe("lunch");
    expect(saved.values.size).toBe(2);
  });

  it.each([
    { origin: "https://other.example" },
    { deviceId: "till-b" },
    { profileId: "dining" },
    { zoneId: "terrace" },
  ])("isolates a different identity %j and retains the original on return", (changed) => {
    const memory = new ZoneMenuMemory(storage());
    memory.remember(identity, lunch, "drinks");
    expect(memory.resolve({ ...identity, ...changed }, lunch, menus, "lunch")).toBe("lunch");
    expect(memory.resolve(identity, lunch, menus, "lunch")).toBe("drinks");
  });

  it.each([
    '["restaurant","2026-10-18","lunch","12:00"]',
    '["restaurant","2026-10-17","lunch","20:00"]',
    '["restaurant","2026-10-18","overnight","00:00"]',
    '["restaurant","2026-12-25","special-date","12:00"]',
    null,
  ])("expires a manual choice at occurrence %s even with the same default", (next) => {
    const saved = storage();
    const memory = new ZoneMenuMemory(saved);
    memory.remember(identity, lunch, "drinks");
    expect(memory.resolve(identity, next, menus, "lunch")).toBe("lunch");
    expect(saved.values.size).toBe(0);
    expect(new ZoneMenuMemory(saved).resolve(identity, lunch, menus, "lunch")).toBe("lunch");
  });

  it("does not resurrect a remembered choice after a closed gap reopens the same occurrence", () => {
    const memory = new ZoneMenuMemory(storage());
    memory.remember(identity, lunch, "drinks");
    expect(
      memory.resolve(
        identity,
        null,
        menus.map((m) => ({ ...m, orderable: false })),
        null,
      ),
    ).toBe("");
    expect(memory.resolve(identity, lunch, menus, "lunch")).toBe("lunch");
  });

  it.each(["removed", "inactive"])(
    "forgets a %s manual menu rather than restoring it later",
    (kind) => {
      const memory = new ZoneMenuMemory(storage());
      memory.remember(identity, lunch, "drinks");
      const available =
        kind === "removed" ? [menu("lunch")] : [menu("lunch"), menu("drinks", false)];
      expect(memory.resolve(identity, lunch, available, "lunch")).toBe("lunch");
      expect(memory.resolve(identity, lunch, menus, "lunch")).toBe("lunch");
    },
  );

  it.each([null, "removed", "closed"])(
    "returns no implicit first menu for unavailable default %s",
    (defaultId) => {
      const memory = new ZoneMenuMemory(null);
      expect(memory.resolve(identity, lunch, [...menus, menu("closed", false)], defaultId)).toBe(
        "",
      );
    },
  );

  it("retains a valid manual choice even when there is no scheduled default", () => {
    const memory = new ZoneMenuMemory(null);
    memory.remember(identity, lunch, "drinks");
    expect(memory.resolve(identity, lunch, menus, null)).toBe("drinks");
  });

  it("overwrites an identity's old occurrence instead of accumulating history", () => {
    const saved = storage();
    const memory = new ZoneMenuMemory(saved);
    for (let day = 1; day <= 40; day++) memory.remember(identity, `day-${day}`, "drinks");
    expect(saved.values.size).toBe(1);
    expect(new ZoneMenuMemory(saved).resolve(identity, "day-40", menus, "lunch")).toBe("drinks");
    expect(new ZoneMenuMemory(saved).resolve(identity, "day-39", menus, "lunch")).toBe("lunch");
  });

  it.each([null, "throws"] as const)(
    "keeps an in-memory choice when storage %s is unavailable",
    (mode) => {
      const blocked = () => {
        throw new Error("storage blocked");
      };
      const memory = new ZoneMenuMemory(
        mode === null ? null : { getItem: blocked, setItem: blocked, removeItem: blocked },
      );
      memory.remember(identity, lunch, "drinks");
      expect(memory.resolve(identity, lunch, menus, "lunch")).toBe("drinks");
      expect(memory.resolve(identity, "tomorrow", menus, "lunch")).toBe("lunch");
      expect(memory.resolve(identity, lunch, menus, "lunch")).toBe("lunch");
    },
  );

  it.each([
    "{",
    "null",
    "[]",
    '"drinks"',
    '{"occurrenceKey":42,"menuId":"drinks"}',
    '{"occurrenceKey":"run","menuId":42}',
  ])("discards malformed stored values %s", (bad) => {
    const saved = storage();
    new ZoneMenuMemory(saved).remember(identity, lunch, "drinks");
    saved.setItem([...saved.values.keys()][0]!, bad);
    const memory = new ZoneMenuMemory(saved);
    expect(memory.resolve(identity, lunch, menus, "lunch")).toBe("lunch");
    expect(saved.values.size).toBe(0);
    memory.remember(identity, lunch, "drinks");
    expect(memory.resolve(identity, lunch, menus, "lunch")).toBe("drinks");
  });

  it("does not resurrect storage's stale value when an expired choice cannot be removed", () => {
    const saved = storage();
    new ZoneMenuMemory(saved).remember(identity, lunch, "drinks");
    const memory = new ZoneMenuMemory({
      ...saved,
      removeItem: () => {
        throw new Error("blocked");
      },
    });
    expect(memory.resolve(identity, "tomorrow", menus, "lunch")).toBe("lunch");
    expect(memory.resolve(identity, lunch, menus, "lunch")).toBe("lunch");
  });
});
