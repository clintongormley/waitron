import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget, toggleFloorView } from "../widgets/test-helpers.js";
import type { FloorRefreshDetail, TillFloorScreen } from "./till-floor-screen.js";
import "./till-floor-screen.js";
import type { FloorZone, TableState, TableToday, TillApi } from "../api/client.js";
import { codeMessage } from "../i18n/codes.js";
import { currentLocale, setLocale } from "../i18n/t.js";

type Offer = FloorZone["layoutDue"];

function zone(id: string, name: string, layoutDue: Offer): FloorZone {
  return {
    id,
    name,
    displayOrder: 0,
    active: true,
    closesAt: null,
    closed: false,
    hasPlan: true,
    layoutSetName: "Lunch",
    layoutDue,
    serviceMode: "table_tab",
  };
}

function table(id: string, zoneId: string, today: Partial<TableToday> | null): TableState {
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
            zoneRevision: 5,
            ...today,
          },
    signals: [],
    party: null,
  };
}

const dinner: Offer = { setId: "set-dinner", revision: 3, periodName: "Dinner" };

function stubApi() {
  return {
    updateLayoutToday: vi.fn<TillApi["updateLayoutToday"]>(() =>
      Promise.resolve({ zoneId: "z1", revision: 6 }),
    ),
  };
}

async function mount(
  zones: FloorZone[],
  { api = stubApi(), canChangeToday = true, tables = [table("t1", "z1", {})] } = {},
) {
  const { el } = await mountWidget<TillFloorScreen>("till-floor-screen", {
    zones,
    tables,
    api: api as unknown as TillApi,
    canChangeToday,
  });
  return { el, api };
}

const bannerOf = (el: TillFloorScreen) =>
  el.shadowRoot!.querySelector<HTMLElement>("[data-layout-due]");
const statusText = (el: TillFloorScreen) =>
  bannerOf(el)?.querySelector('[role="status"]')?.textContent?.trim() ?? null;
const updateButton = (el: TillFloorScreen) =>
  bannerOf(el)?.querySelector<HTMLElement>("[data-update-layout]") ?? null;

async function settle(el: TillFloorScreen): Promise<void> {
  for (let i = 0; i < 3; i++) await Promise.resolve();
  await el.updateComplete;
}

const follows = (a: Element, b: Element) =>
  (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

const locale = currentLocale();
afterEach(() => {
  cleanupWidgets();
  setLocale(locale);
});

describe("till-floor-screen: the layout banner", () => {
  it("says the period's layout is ready, under the tabs and above the map and the list", async () => {
    setLocale("en-GB");
    const { el } = await mount([zone("z1", "Terrace", dinner), zone("z2", "Bar", null)]);
    expect(statusText(el)).toBe("Dinner layout is ready.");
    expect(updateButton(el)!.textContent!.trim()).toBe("Update layout");
    const tabs = el.shadowRoot!.querySelector(".zone-toolbar")!;
    const map = el.shadowRoot!.querySelector("wt-floor-map")!;
    expect(follows(tabs, bannerOf(el)!)).toBe(true);
    expect(follows(bannerOf(el)!, map)).toBe(true);

    await toggleFloorView(el);
    const list = el.shadowRoot!.querySelector(".grid")!;
    expect(statusText(el)).toBe("Dinner layout is ready.");
    expect(follows(bannerOf(el)!, list)).toBe(true);
  });

  it("says a newer layout is ready when the offer names no period, in Spanish too", async () => {
    setLocale("en-GB");
    const offer = { ...dinner, periodName: null };
    const { el } = await mount([zone("z1", "Terrace", offer)]);
    expect(statusText(el)).toBe("A newer layout is ready.");
    setLocale("es-ES");
    el.requestUpdate();
    await el.updateComplete;
    expect(statusText(el)).toBe("Hay un plano más reciente.");
    expect(updateButton(el)!.textContent!.trim()).toBe("Actualizar plano");
  });

  it("names the period in Spanish", async () => {
    setLocale("es-ES");
    const { el } = await mount([zone("z1", "Terraza", dinner)]);
    expect(statusText(el)).toBe("El plano de Dinner está listo.");
  });

  it("shows the active zone's offer only", async () => {
    setLocale("en-GB");
    const { el } = await mount([zone("z1", "Terrace", null), zone("z2", "Bar", dinner)], {
      tables: [table("t1", "z1", {}), table("t2", "z2", {})],
    });
    expect(bannerOf(el)).toBeNull();
    el.shadowRoot!.querySelector<HTMLElement>('.tabs [data-zone="z2"]')!.click();
    await el.updateComplete;
    expect(statusText(el)).toBe("Dinner layout is ready.");
  });

  it("shows no banner on a device that may not change today's plan", async () => {
    const { el } = await mount([zone("z1", "Terrace", dinner)], { canChangeToday: false });
    expect(bannerOf(el)).toBeNull();
  });

  it("has no close button", async () => {
    const { el } = await mount([zone("z1", "Terrace", dinner)]);
    expect(bannerOf(el)!.querySelectorAll("wt-button, button")).toHaveLength(1);
  });

  it("sends the offered set and revision with the room's revision, then asks for the zones as well as the tables", async () => {
    const { el, api } = await mount([zone("z1", "Terrace", dinner)]);
    const asked: (FloorRefreshDetail | null)[] = [];
    el.addEventListener("floor-refresh", (event) =>
      asked.push((event as CustomEvent<FloorRefreshDetail | null>).detail),
    );
    updateButton(el)!.click();
    await settle(el);
    expect(api.updateLayoutToday).toHaveBeenCalledExactlyOnceWith(
      "z1",
      { setId: "set-dinner", revision: 3 },
      5,
    );
    expect(asked).toEqual([{ zones: true }]);
  });

  it("sends null as the room's revision when the read holds no table of the zone with a today's row", async () => {
    const { el, api } = await mount([zone("z1", "Terrace", dinner)], {
      tables: [table("t1", "z1", null), table("t2", "z2", {})],
    });
    updateButton(el)!.click();
    await settle(el);
    expect(api.updateLayoutToday).toHaveBeenCalledExactlyOnceWith(
      "z1",
      { setId: "set-dinner", revision: 3 },
      null,
    );
  });

  it("says the layout changed when refused, and still asks for the zones and the tables", async () => {
    setLocale("en-GB");
    const api = {
      updateLayoutToday: vi.fn<TillApi["updateLayoutToday"]>(() =>
        Promise.reject({ code: "floor_today.layout_changed", zoneId: "z1" }),
      ),
    };
    const { el } = await mount([zone("z1", "Terrace", dinner)], { api });
    const asked: (FloorRefreshDetail | null)[] = [];
    el.addEventListener("floor-refresh", (event) =>
      asked.push((event as CustomEvent<FloorRefreshDetail | null>).detail),
    );
    updateButton(el)!.click();
    await settle(el);
    expect(el.shadowRoot!.querySelector("[data-floor-refusal]")!.textContent!.trim()).toBe(
      codeMessage("floor_today.layout_changed"),
    );
    expect(asked).toEqual([{ zones: true }]);
  });
});
