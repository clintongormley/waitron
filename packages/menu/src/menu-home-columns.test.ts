import { describe, expect, it } from "vitest";
import { captureError, withTransaction } from "@waitron/db";
import { useCatalogueDb } from "../test/fixtures.js";
import { menusFixture } from "../test/menus-fixture.js";
import { readMenuHome, setHomeDisplay } from "./menu-home.js";

const fx = useCatalogueDb();

describe("home column limits", () => {
  it.each([
    ["handheld", 2],
    ["handheld", 3],
    ["till", 4],
    ["till", 5],
    ["till", 10],
  ] as const)("stores %s with %i columns", async (device, columns) => {
    const f = await menusFixture(fx.db);
    await withTransaction(fx.db, (tx) => setHomeDisplay(tx, f.lunch, device, { columns }));
    const saved = await withTransaction(fx.db, (tx) => readMenuHome(tx, f.lunch));
    expect(saved[device].columns).toBe(columns);
    expect(saved[device === "till" ? "handheld" : "till"].columns).toBe(device === "till" ? 3 : 6);
  });

  it.each([
    ["handheld", 1],
    ["handheld", 4],
    ["handheld", 6],
    ["till", 3],
    ["till", 11],
  ] as const)(
    "refuses %s with %i columns without changing either display",
    async (device, columns) => {
      const f = await menusFixture(fx.db);
      const before = await withTransaction(fx.db, (tx) => readMenuHome(tx, f.lunch));
      expect(
        await captureError(() =>
          withTransaction(fx.db, (tx) => setHomeDisplay(tx, f.lunch, device, { columns })),
        ),
      ).toMatchObject({ code: "menu.home_display_invalid", params: { device, field: "columns" } });
      expect(await withTransaction(fx.db, (tx) => readMenuHome(tx, f.lunch))).toEqual(before);
    },
  );
});
