import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import type { TillFloorScreen } from "./till-floor-screen.js";
import "./till-floor-screen.js";
import type { FloorZone, TableState, TableToday, TillApi } from "../api/client.js";
import type { TillFloorZoneMenu } from "../widgets/floor-zone-menu.js";
import { spareSpot } from "../state/floor-today.js";

function zone(id: string, name: string, hasPlan = true): FloorZone {
  return {
    id,
    name,
    displayOrder: 0,
    active: true,
    closesAt: null,
    closed: false,
    hasPlan,
    layoutSetName: null,
    layoutDue: null,
    serviceMode: "table_tab",
  };
}

function table(
  id: string,
  zoneId: string,
  today: Partial<TableToday> | null,
  over: Partial<TableState> = {},
): TableState {
  return {
    id,
    label: id.slice(1),
    zoneId,

    state: "free",
    condition: "free",
    hasOpenTab: false,
    pendingDeliveries: 0,
    pendingToServe: 0,
    readyToServe: 0,
    enRoute: 0,
    timingBand: "fresh",
    nextReservation: null,
    today:
      today === null
        ? null
        : {
            placement: { x: 2, y: 3, width: 8, height: 8, shape: "rect", rotation: 0 },
            seats: 4,
            fixed: false,
            takenOff: false,
            joinId: null,
            joinSeats: null,
            inJoinedTable: null,
            joined: null,
            splitOffFrom: null,
            zoneRevision: 0,
            ...today,
          },
    signals: [],
    party: null,
    ...over,
  };
}

const zones = [zone("z1", "Terrace"), zone("z2", "Bar", false), zone("z3", "Patio")];
const terraceTables = [
  table("t1", "z1", {}),
  table("t2", "z1", {
    placement: { x: 40, y: 30, width: 8, height: 8, shape: "rect", rotation: 0 },
  }),
  table("t9", "z1", { placement: null }),
  table("t3", "z1", { placement: null, takenOff: true }),
];
const barTables = [table("t5", "z2", null, {})];
const patioTables = [
  table("t6", "z3", {
    placement: { x: 300, y: 300, width: 8, height: 8, shape: "rect", rotation: 0 },
  }),
];

function stubApi() {
  const answer = () => Promise.resolve({ zoneId: "z1", revision: 0 });
  return {
    placeSpareToday: vi.fn<TillApi["placeSpareToday"]>(answer),
    putBackToday: vi.fn<TillApi["putBackToday"]>(answer),
    resetZoneToday: vi.fn<TillApi["resetZoneToday"]>(answer),
  };
}

async function mount(api = stubApi(), canChangeToday = true) {
  const { el } = await mountWidget<TillFloorScreen>("till-floor-screen", {
    zones,
    tables: [...terraceTables, ...barTables, ...patioTables],
    api: api as unknown as TillApi,
    canChangeToday,
  });
  return el;
}

const menuOf = (el: TillFloorScreen) =>
  el.shadowRoot!.querySelector<TillFloorZoneMenu>(".actions till-floor-zone-menu");

async function showZone(el: TillFloorScreen, zoneId: string): Promise<void> {
  el.shadowRoot!.querySelector<HTMLElement>(`.tabs [data-zone="${zoneId}"]`)!.click();
  await el.updateComplete;
}

async function toggleView(el: TillFloorScreen): Promise<void> {
  el.shadowRoot!.querySelector<HTMLElement>("[data-view-toggle]")!.click();
  await el.updateComplete;
}

function countRefreshes(el: TillFloorScreen): { count: number } {
  const seen = { count: 0 };
  el.addEventListener("floor-refresh", () => seen.count++);
  return seen;
}

async function settle(el: TillFloorScreen): Promise<void> {
  for (let i = 0; i < 3; i++) await Promise.resolve();
  await el.updateComplete;
}

async function send(el: TillFloorScreen, type: string, detail: object): Promise<void> {
  menuOf(el)!.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  await settle(el);
}

function refusal(el: TillFloorScreen): string | null {
  return el.shadowRoot!.querySelector("[data-floor-refusal]")?.textContent?.trim() ?? null;
}

afterEach(cleanupWidgets);

// The toolbar's List/Map button and a menu only for today's plan are the wider screen's; a phone's
// menu is in "the zone menu on a phone and wider".
const startWidth = innerWidth,
  startHeight = innerHeight;
beforeEach(async () => {
  await page.viewport(1280, 844);
});
afterEach(async () => {
  await page.viewport(startWidth, startHeight);
});

describe("till-floor-screen: the zone menu", () => {
  it("shows the zone menu for a planned zone only, in both views", async () => {
    const el = await mount();
    await showZone(el, "z1");
    expect(el.shadowRoot!.querySelector("wt-floor-map")).not.toBeNull();
    expect(menuOf(el)!.zone).toEqual(zones[0]);
    expect(menuOf(el)!.tables.map((each) => each.id)).toEqual(["t1", "t2", "t9", "t3"]);

    await toggleView(el);
    expect(el.shadowRoot!.querySelector("wt-floor-map")).toBeNull();
    expect(menuOf(el)).not.toBeNull();

    await showZone(el, "z2");
    expect(menuOf(el)).toBeNull();
    await toggleView(el);
    expect(menuOf(el)).toBeNull();
  });

  it("is not offered to a device that cannot change today's plan", async () => {
    const el = await mount(stubApi(), false);
    await showZone(el, "z1");
    expect(el.shadowRoot!.querySelector("wt-floor-map")).not.toBeNull();
    expect(menuOf(el)).toBeNull();
    await toggleView(el);
    expect(menuOf(el)).toBeNull();
  });

  it("offers a zone with no tables a reset, which brings in the tables its layout has gained", async () => {
    const api = stubApi();
    const { el } = await mountWidget<TillFloorScreen>("till-floor-screen", {
      zones: [...zones, zone("z4", "Garden")],
      tables: [...terraceTables, ...barTables, ...patioTables],
      api: api as unknown as TillApi,
      canChangeToday: true,
    });
    await showZone(el, "z4");
    expect(menuOf(el)!.zone!.id).toBe("z4");
    const refreshes = countRefreshes(el);
    await send(el, "zone-reset", { zoneId: "z4" });
    expect(api.resetZoneToday).toHaveBeenCalledExactlyOnceWith("z4", null);
    expect(refreshes.count).toBe(1);
  });

  it("is not offered to a zone with no tables and no layout", async () => {
    const { el } = await mountWidget<TillFloorScreen>("till-floor-screen", {
      zones: [...zones, zone("z4", "Counter", false)],
      tables: [...terraceTables, ...barTables, ...patioTables],
      api: stubApi() as unknown as TillApi,
      canChangeToday: true,
    });
    await showZone(el, "z4");
    expect(menuOf(el)).toBeNull();
  });

  it("places a spare in the middle of the zone, puts a table back and resets the zone", async () => {
    const api = stubApi();
    const el = await mount(api);
    await showZone(el, "z1");
    const refreshes = countRefreshes(el);
    const middle = spareSpot(terraceTables);
    expect(middle).not.toEqual(spareSpot([...terraceTables, ...patioTables]));
    expect(middle).not.toEqual({ x: 0, y: 0 });

    await send(el, "zone-place-spare", { tableId: "t9" });
    expect(api.placeSpareToday).toHaveBeenCalledExactlyOnceWith("t9", middle, 0);
    expect(refreshes.count).toBe(1);

    await send(el, "zone-put-back", { tableId: "t3" });
    expect(api.putBackToday).toHaveBeenCalledExactlyOnceWith("t3", 0);
    expect(refreshes.count).toBe(2);

    await send(el, "zone-reset", { zoneId: "z1" });
    expect(api.resetZoneToday).toHaveBeenCalledExactlyOnceWith("z1", 0);
    expect(refreshes.count).toBe(3);
    expect(refusal(el)).toBeNull();
  });

  it("says why a change was refused, and clears it with the next one", async () => {
    const api = stubApi();
    api.placeSpareToday.mockRejectedValueOnce({ code: "table.fixed", status: 409 });
    const el = await mount(api);
    await showZone(el, "z1");
    const refreshes = countRefreshes(el);

    await send(el, "zone-place-spare", { tableId: "t9" });
    expect(refusal(el)).toBe("That table is fixed in place");
    expect(refreshes.count).toBe(1);

    await send(el, "zone-put-back", { tableId: "t3" });
    expect(refusal(el)).toBeNull();
  });

  it("sends nothing and re-reads nothing without an api", async () => {
    const { el } = await mountWidget<TillFloorScreen>("till-floor-screen", {
      zones,
      tables: terraceTables,
      canChangeToday: true,
    });
    const refreshes = countRefreshes(el);
    await send(el, "zone-reset", { zoneId: "z1" });
    expect(refreshes.count).toBe(0);
  });

  it("keeps the menu's events inside the screen", async () => {
    const el = await mount();
    await showZone(el, "z1");
    const escaped: string[] = [];
    for (const type of ["zone-place-spare", "zone-put-back", "zone-reset"])
      el.addEventListener(type, () => escaped.push(type));
    await send(el, "zone-place-spare", { tableId: "t9" });
    await send(el, "zone-put-back", { tableId: "t3" });
    await send(el, "zone-reset", { zoneId: "z1" });
    expect(escaped).toEqual([]);
  });
});

describe("till-floor-screen: the zone menu and the room's revision", () => {
  const terraceAt7 = () =>
    terraceTables.map((each) => ({ ...each, today: { ...each.today!, zoneRevision: 7 } }));

  async function mountAt7(api = stubApi()) {
    const { el } = await mountWidget<TillFloorScreen>("till-floor-screen", {
      zones: [...zones, zone("z4", "Garden")],
      tables: [...terraceAt7(), ...barTables, ...patioTables],
      api: api as unknown as TillApi,
      canChangeToday: true,
    });
    return el;
  }

  it("each action sends the read's revision, and a zone reset with no tables sends none", async () => {
    const actions: [string, object, (api: ReturnType<typeof stubApi>) => unknown, unknown[]][] = [
      [
        "zone-place-spare",
        { tableId: "t9" },
        (api) => api.placeSpareToday,
        ["t9", spareSpot(terraceAt7()), 7],
      ],
      ["zone-put-back", { tableId: "t3" }, (api) => api.putBackToday, ["t3", 7]],
      ["zone-reset", { zoneId: "z1" }, (api) => api.resetZoneToday, ["z1", 7]],
    ];
    for (const [type, detail, route, args] of actions) {
      const api = stubApi();
      const el = await mountAt7(api);
      await showZone(el, "z1");
      await send(el, type, detail);
      expect(route(api)).toHaveBeenCalledExactlyOnceWith(...args);
      cleanupWidgets();
    }

    const api = stubApi();
    const el = await mountAt7(api);
    await showZone(el, "z4");
    await send(el, "zone-reset", { zoneId: "z4" });
    expect(api.resetZoneToday).toHaveBeenCalledExactlyOnceWith("z4", null);
  });

  it("guards a state the menu never offers, since `sparesOf` and `takenOffOf` list only tables with a today's row: a table change from a zone with no today's row sends nothing, says the floor has changed and re-reads", async () => {
    const api = stubApi();
    const el = await mountAt7(api);
    await showZone(el, "z4");
    const refreshes = countRefreshes(el);
    await send(el, "zone-put-back", { tableId: "t3" });
    expect(api.putBackToday).not.toHaveBeenCalled();
    expect(refusal(el)).toBe("The floor has changed. Check and try again");
    expect(refreshes.count).toBe(1);
  });
});

describe("till-floor-screen: the zone menu on a phone and wider", () => {
  const inside = { ...zone("z1", "Inside"), layoutSetName: "Dinner" };

  async function mountAt(
    width: number,
    over: { zones?: FloorZone[]; canChangeToday?: boolean; api?: ReturnType<typeof stubApi> } = {},
  ) {
    await page.viewport(width, 844);
    expect(innerWidth).toBe(width);
    const { el } = await mountWidget<TillFloorScreen>("till-floor-screen", {
      zones: over.zones ?? [inside, zones[1]!],
      tables: [...terraceTables, ...barTables],
      api: (over.api ?? stubApi()) as unknown as TillApi,
      canChangeToday: over.canChangeToday ?? true,
    });
    return el;
  }

  /** Each entry the menu's popup holds, in order: an action's text, or a heading's marked `heading:`. */
  async function entries(el: TillFloorScreen): Promise<string[]> {
    const menu = menuOf(el)!;
    await menu.updateComplete;
    const actions = menu.shadowRoot!.querySelector("wt-row-actions")!;
    return [...actions.children].map((child) => {
      const words = child.textContent!.replace(/\s+/g, " ").trim();
      return child.matches("wt-button, button, a") ? words : `heading: ${words}`;
    });
  }

  /** The ⋮ button's accessible name. */
  async function menuName(el: TillFloorScreen): Promise<string | null> {
    const actions = menuOf(el)!.shadowRoot!.querySelector("wt-row-actions")!;
    await actions.updateComplete;
    return actions.shadowRoot!.querySelector("button")!.getAttribute("aria-label");
  }

  async function chooseItem(el: TillFloorScreen, item: string): Promise<void> {
    const menu = menuOf(el)!;
    menu.shadowRoot!.querySelector<HTMLElement>(`[data-menu-item="${item}"]`)!.click();
    await menu.updateComplete;
    await el.updateComplete;
  }

  it("at 1280 keeps List and the menu in the toolbar, with no heading, and names the recorded set", async () => {
    const el = await mountAt(1280);
    const toggle = el.shadowRoot!.querySelector<HTMLElement>(".actions [data-view-toggle]");
    expect(toggle?.textContent?.trim()).toBe("List");
    expect(await entries(el)).toEqual([
      "Add a spare table",
      "Taken off today",
      "Reset to Dinner plan",
    ]);
  });

  it("offers no reset while the zone records no set", async () => {
    const el = await mountAt(1280, { zones: [{ ...inside, layoutSetName: null }] });
    expect(await entries(el)).toEqual(["Add a spare table", "Taken off today"]);
  });

  it("asks before the reset with the new second line", async () => {
    const el = await mountAt(1280);
    await chooseItem(el, "reset");
    const dialog = menuOf(el)!.shadowRoot!.querySelector('wt-dialog[data-dialog="reset"]')!;
    expect(dialog.querySelector("[data-reset-body]")!.textContent!.trim()).toBe(
      "Free tables go back now; occupied ones show Needs moving once free.",
    );
  });

  it("at 390 moves List into the menu, above the muted heading and the three items, and Map on the list", async () => {
    const el = await mountAt(390);
    expect(el.shadowRoot!.querySelector("[data-view-toggle]")).toBeNull();
    expect(await entries(el)).toEqual([
      "List",
      "heading: Today's plan · Inside",
      "Add a spare table",
      "Taken off today",
      "Reset to Dinner plan",
    ]);
    await chooseItem(el, "view");
    expect(el.shadowRoot!.querySelector("wt-floor-map")).toBeNull();
    expect((await entries(el))[0]).toBe("Map");
    await chooseItem(el, "view");
    expect(el.shadowRoot!.querySelector("wt-floor-map")).not.toBeNull();
  });

  it("at 390 gives someone who cannot change today's plan a menu holding only List or Map", async () => {
    const el = await mountAt(390, { canChangeToday: false });
    expect(await entries(el)).toEqual(["List"]);
    await chooseItem(el, "view");
    expect(await entries(el)).toEqual(["Map"]);
  });

  it("at 390 names the menu for today's plan while it holds the plan's items", async () => {
    const el = await mountAt(390);
    expect(await menuName(el)).toBe("Today's plan");
  });

  it("at 390 names the menu for the floor's view when it holds only List or Map", async () => {
    const el = await mountAt(390, { canChangeToday: false });
    expect(await menuName(el)).toBe("Floor view");
  });

  it("at 390 gives a zone with no plan a menu holding only List or Map", async () => {
    const el = await mountAt(390);
    await showZone(el, "z2");
    expect(await entries(el)).toEqual(["Map"]);
  });

  it("at 390 gives a floor with no zones a menu holding only List or Map", async () => {
    const el = await mountAt(390, { zones: [] });
    expect(await entries(el)).toEqual(["Map"]);
  });

  it("at 390 keeps the toggle's event inside the screen", async () => {
    const el = await mountAt(390);
    const escaped: string[] = [];
    el.addEventListener("zone-toggle-view", () => escaped.push("zone-toggle-view"));
    await chooseItem(el, "view");
    expect(escaped).toEqual([]);
  });

  it("asks for the zones as well as the tables after a reset, sent or refused", async () => {
    const api = stubApi();
    api.resetZoneToday.mockRejectedValueOnce({ code: "table.fixed", status: 409 });
    const el = await mountAt(1280, { api });
    const details: unknown[] = [];
    el.addEventListener("floor-refresh", (event) => details.push((event as CustomEvent).detail));
    await send(el, "zone-reset", { zoneId: "z1" });
    await send(el, "zone-reset", { zoneId: "z1" });
    expect(api.resetZoneToday).toHaveBeenCalledTimes(2);
    expect(details).toEqual([{ zones: true }, { zones: true }]);
  });
});
