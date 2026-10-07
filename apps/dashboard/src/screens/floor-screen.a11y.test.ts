import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import "./floor-screen.js";
import type { FloorScreen } from "./floor-screen.js";
import type { DashboardApi, DashboardTable, FloorZone } from "../api/client.js";

const ZONES: FloorZone[] = [{ id: "z1", name: "Comedor", displayOrder: 0, active: true }];

const TABLES: DashboardTable[] = [
  {
    id: "t1",
    label: "4",
    zoneId: "z1",
    capacity: 2,
    active: true,
    createdAt: "2026-08-17T00:00:00Z",
  },
];

/** One placed table (selectable, to open the edit inspector) and one in the tray. */
const PLACED_TABLES: DashboardTable[] = [
  {
    id: "t1",
    label: "1",
    zoneId: "z1",
    capacity: 4,
    active: true,
    createdAt: "2026-08-17T00:00:00Z",
    posX: 250,
    posY: 400,
    shape: "round",
    rotation: 0,
  },
  {
    id: "t2",
    label: "2",
    zoneId: "z1",
    capacity: 2,
    active: true,
    createdAt: "2026-08-17T00:00:00Z",
    posX: null,
    posY: null,
    shape: null,
    rotation: null,
  },
];

function stubApi(zones: FloorZone[], tables: DashboardTable[]): DashboardApi {
  return {
    listZones: vi.fn().mockResolvedValue(zones.map((z) => ({ ...z }))),
    listTables: vi.fn().mockResolvedValue(tables.map((t) => ({ ...t }))),
    updateZone: vi.fn().mockResolvedValue(undefined),
    deactivateZone: vi.fn().mockResolvedValue(undefined),
    createTable: vi.fn().mockResolvedValue({ id: "t9" }),
    updateTable: vi.fn().mockResolvedValue(undefined),
    deactivateTable: vi.fn().mockResolvedValue(undefined),
    setTablePlacement: vi.fn().mockResolvedValue(undefined),
    clearPlacement: vi.fn().mockResolvedValue(undefined),
  } as unknown as DashboardApi;
}

async function flush(el: FloorScreen): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
}

afterEach(cleanupWidgets);

function change(el: FloorScreen, selector: string, value: string): void {
  el.shadowRoot!.querySelector(selector)!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
}

function button(el: FloorScreen, selector: string) {
  return el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(`wt-button${selector}`)!;
}

describe.each(["light", "dark"] as const)("floor-screen a11y (%s theme)", (theme) => {
  it("renders accessibly with a populated list", async () => {
    const { el, host } = await mountWidget<FloorScreen>(
      "dashboard-floor-screen",
      { api: stubApi(ZONES, TABLES) },
      theme,
    );
    await flush(el);
    await expectNoA11yViolations(host);
  });

  it("renders accessibly with a disabled table offering Enable beside an active one", async () => {
    const { el, host } = await mountWidget<FloorScreen>(
      "dashboard-floor-screen",
      {
        api: stubApi(ZONES, [...TABLES, { ...TABLES[0]!, id: "t2", label: "5", active: false }]),
      },
      theme,
    );
    await flush(el);
    expect(el.shadowRoot!.querySelector('[data-test="table-enable-t2"]')).not.toBeNull();
    await expectNoA11yViolations(host);
  });

  it("renders accessibly with Save quiet on an untouched table and loud on an edited one", async () => {
    const { el, host } = await mountWidget<FloorScreen>(
      "dashboard-floor-screen",
      { api: stubApi(ZONES, [...TABLES, { ...TABLES[0]!, id: "t2", label: "5" }]) },
      theme,
    );
    await flush(el);
    change(el, '[data-test="table-label-t1"]', "4B");
    change(el, "[data-new-table]", "12");
    await el.updateComplete;
    expect(button(el, '[data-test="table-save-t1"]').variant).toBe("primary");
    expect(button(el, '[data-test="table-save-t2"]').variant).toBe("secondary");
    expect(button(el, "[data-add-table]").variant).toBe("primary");
    await expectNoA11yViolations(host);
  });

  it("renders accessibly with empty lists", async () => {
    const { el, host } = await mountWidget<FloorScreen>(
      "dashboard-floor-screen",
      { api: stubApi([], []) },
      theme,
    );
    await flush(el);
    await expectNoA11yViolations(host);
  });

  it("renders the Plano editor accessibly with the canvas edit inspector open", async () => {
    const { el, host } = await mountWidget<FloorScreen>(
      "dashboard-floor-screen",
      { api: stubApi(ZONES, PLACED_TABLES) },
      theme,
    );
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>('[data-tab="plano"]')!.dispatchEvent(
      new Event("click"),
    );
    await el.updateComplete;
    // Opening the tab alone leaves the edit inspector unrendered; selecting a table inside the
    // canvas puts it in the tree for axe.
    const canvas = el.shadowRoot!.querySelector("wt-floor-canvas") as HTMLElement & {
      shadowRoot: ShadowRoot;
      updateComplete: Promise<unknown>;
    };
    canvas.shadowRoot.querySelector<HTMLElement>("[data-table]")!.click();
    await canvas.updateComplete;
    await el.updateComplete;
    expect(canvas.shadowRoot.querySelector(".inspector")).not.toBeNull();
    await expectNoA11yViolations(host);
  });

  it("renders accessibly with the error banner shown", async () => {
    const api = {
      ...stubApi(ZONES, TABLES),
      createTable: vi.fn().mockRejectedValue({ code: "table.label_taken" }),
    } as unknown as DashboardApi;
    const { el, host } = await mountWidget<FloorScreen>("dashboard-floor-screen", { api }, theme);
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>("[data-new-table]")!.dispatchEvent(
      new CustomEvent("wt-change", { detail: { value: "4" }, bubbles: true, composed: true }),
    );
    el.shadowRoot!.querySelector<HTMLElement>("[data-add-table]")!.click();
    await flush(el);
    await expectNoA11yViolations(host);
  });
});
