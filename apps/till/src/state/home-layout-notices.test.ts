import { describe, expect, it } from "vitest";
import type { MenuState, TillZoneMenu } from "../api/client.js";
import { RemovedLayoutReports, withPolledLayouts } from "./home-layout-notices.js";

function menu(id: string, overrides: Partial<TillZoneMenu> = {}): TillZoneMenu {
  return {
    id,
    name: `${id} menu`,
    isDefault: false,
    versionId: "v1",
    structure: { members: [] },
    homeLayouts: [
      { id: `${id}-home`, name: `${id} Home`, tiles: [] },
      { id: `${id}-bar`, name: `${id} Bar`, tiles: [] },
    ],
    defaultHomeLayoutId: `${id}-home`,
    homeLayoutId: `${id}-home`,
    layoutFallback: null,
    ...overrides,
  };
}

function answer(
  menuId: string,
  overrides: Partial<MenuState["menus"][number]> = {},
): MenuState["menus"][number] {
  return {
    menuId,
    versionId: "v1",
    homeLayoutId: `${menuId}-home`,
    layoutFallback: null,
    ...overrides,
  };
}

/** The server's answer once a menu's chosen layout is deleted: the default, and why. */
function fellBack(shown: TillZoneMenu): TillZoneMenu {
  return { ...shown, homeLayoutId: shown.defaultHomeLayoutId, layoutFallback: "layout_removed" };
}

describe("withPolledLayouts", () => {
  it("answers the same array when no answer changes a layout", () => {
    const loaded = [menu("lunch"), menu("dinner")];
    expect(withPolledLayouts(loaded, [answer("lunch"), answer("dinner")])).toBe(loaded);
    expect(withPolledLayouts(loaded, [])).toBe(loaded);
  });

  it("applies a new layout on the held version as a new menu object, leaving the others as they were", () => {
    const loaded = [menu("lunch"), menu("dinner")];
    const polled = withPolledLayouts(loaded, [
      answer("lunch", { homeLayoutId: "lunch-bar" }),
      answer("dinner"),
    ]);
    expect(polled).not.toBe(loaded);
    expect(polled[0]).toEqual({ ...loaded[0], homeLayoutId: "lunch-bar", layoutFallback: null });
    expect(polled[0]).not.toBe(loaded[0]);
    expect(polled[1]).toBe(loaded[1]);
  });

  it("applies a new fallback reason on its own", () => {
    const loaded = [menu("lunch")];
    const polled = withPolledLayouts(loaded, [
      answer("lunch", { layoutFallback: "layout_unpublished" }),
    ]);
    expect(polled[0]).toEqual({ ...loaded[0], layoutFallback: "layout_unpublished" });
  });

  it("leaves a menu the poll names at another version for its reload", () => {
    const loaded = [menu("lunch")];
    expect(
      withPolledLayouts(loaded, [answer("lunch", { versionId: "v2", homeLayoutId: "lunch-bar" })]),
    ).toBe(loaded);
  });
});

describe("RemovedLayoutReports", () => {
  it("names a removed layout the till was showing, from the menus it showed", () => {
    const reports = new RemovedLayoutReports();
    const shown = menu("lunch", { homeLayoutId: "lunch-bar" });
    expect(reports.report([shown], [fellBack(shown)])).toEqual([
      { menuName: "lunch menu", layoutName: "lunch Bar" },
    ]);
  });

  it("says nothing about a menu that did not fall back because its layout was removed", () => {
    const reports = new RemovedLayoutReports();
    const shown = menu("lunch", { homeLayoutId: "lunch-bar" });
    expect(reports.report([shown], [menu("lunch")])).toEqual([]);
    expect(
      reports.report([shown], [{ ...fellBack(shown), layoutFallback: "layout_unpublished" }]),
    ).toEqual([]);
  });

  it("says a named removal once, however often the server repeats it", () => {
    const reports = new RemovedLayoutReports();
    const shown = menu("lunch", { homeLayoutId: "lunch-bar" });
    const next = fellBack(shown);
    expect(reports.report([shown], [next])).toHaveLength(1);
    expect(reports.report([next], [next])).toEqual([]);
    expect(reports.report([shown], [next])).toEqual([]);
  });

  it("says a removal it cannot name on a first load, once", () => {
    const reports = new RemovedLayoutReports();
    const loaded = fellBack(menu("lunch"));
    expect(reports.report([], [loaded])).toEqual([{ menuName: "lunch menu" }]);
    expect(reports.report([], [loaded])).toEqual([]);
    expect(reports.report([loaded], [loaded])).toEqual([]);
  });

  it("cannot name a layout the shown menu no longer lists", () => {
    const reports = new RemovedLayoutReports();
    const shown = menu("lunch", { homeLayoutId: "lunch-gone" });
    expect(reports.report([shown], [fellBack(shown)])).toEqual([{ menuName: "lunch menu" }]);
  });

  it("says nothing unnamed once something has been said about the menu", () => {
    const reports = new RemovedLayoutReports();
    const shown = menu("lunch", { homeLayoutId: "lunch-bar" });
    expect(reports.report([shown], [fellBack(shown)])).toHaveLength(1);
    expect(reports.report([], [fellBack(shown)])).toEqual([]);
  });

  it("still names a removal after an unnamed one, and each named layout once", () => {
    const reports = new RemovedLayoutReports();
    const bar = menu("lunch", { homeLayoutId: "lunch-bar" });
    expect(reports.report([], [fellBack(bar)])).toEqual([{ menuName: "lunch menu" }]);
    expect(reports.report([bar], [fellBack(bar)])).toEqual([
      { menuName: "lunch menu", layoutName: "lunch Bar" },
    ]);
    const terrace = menu("lunch", {
      homeLayouts: [...bar.homeLayouts, { id: "lunch-terrace", name: "Terrace", tiles: [] }],
      homeLayoutId: "lunch-terrace",
    });
    expect(reports.report([terrace], [fellBack(terrace)])).toEqual([
      { menuName: "lunch menu", layoutName: "Terrace" },
    ]);
    expect(reports.report([bar], [fellBack(bar)])).toEqual([]);
  });

  it("keeps each menu's reports apart", () => {
    const reports = new RemovedLayoutReports();
    const lunch = fellBack(menu("lunch"));
    const dinner = fellBack(menu("dinner"));
    expect(reports.report([], [lunch])).toEqual([{ menuName: "lunch menu" }]);
    expect(reports.report([], [lunch, dinner])).toEqual([{ menuName: "dinner menu" }]);
  });
});
