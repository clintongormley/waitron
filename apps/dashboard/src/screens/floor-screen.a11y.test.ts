import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import "./floor-screen.js";
import type { FloorScreen } from "./floor-screen.js";
import type { DashboardApi, DashboardTable, FloorZone } from "../api/client.js";

/**
 * The floor-plan config screen scanned by axe in both themes, in three shapes: populated (a zone + a table,
 * so both panels' rows and the zone <select> render), empty (just the two new-item forms and the empty
 * states), and the error state (a rejected zone create shows the `role="alert"` banner). Mounted by
 * ASSIGNING the `api` stub as a property; the screen loads on connect, so the stub must resolve or a
 * stray rejection pollutes the run (a rejection is a finding). Every colour is a `--wt-*` token; the
 * native `type="number"` inputs and the token-styled `<select>` carry HA-styled labels for axe.
 */
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

/** For the Plano-tab scan: a PLACED table (drawn on the canvas, so it can be selected to open the edit
 * inspector) plus an UNPLACED one (the tray), so axe sees both the canvas chrome and a tray token. */
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
    createZone: vi.fn().mockResolvedValue({ id: "z9" }),
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
    // Open the Plano tab so the editable canvas + tray render…
    el.shadowRoot!.querySelector<HTMLElement>('[data-tab="plano"]')!.dispatchEvent(
      new Event("click"),
    );
    await el.updateComplete;
    // …then SELECT the placed table inside the canvas so its edit inspector (shape palette / zone /
    // rotate / remove), rendered with the dashboard's SPANISH copy, is in the tree for axe. The
    // inspector needs the canvas's own `selectedId`, set by its `#onTap` — so click a `[data-table]`
    // inside the canvas's shadow root (mirrors the Task-6 till a11y fix; opening the tab alone leaves
    // the inspector unrendered, so the Spanish chrome would go unscanned).
    const canvas = el.shadowRoot!.querySelector("wt-floor-canvas") as HTMLElement & {
      shadowRoot: ShadowRoot;
      updateComplete: Promise<unknown>;
    };
    canvas.shadowRoot.querySelector<HTMLElement>("[data-table]")!.click();
    await canvas.updateComplete;
    await el.updateComplete;
    // The inspector is present (so axe scans the real Spanish edit chrome, not an empty canvas).
    expect(canvas.shadowRoot.querySelector(".inspector")).not.toBeNull();
    await expectNoA11yViolations(host);
  });

  it("renders accessibly with the error banner shown", async () => {
    const api = {
      ...stubApi(ZONES, TABLES),
      createZone: vi.fn().mockRejectedValue({ code: "zone.name_taken" }),
    } as unknown as DashboardApi;
    const { el, host } = await mountWidget<FloorScreen>("dashboard-floor-screen", { api }, theme);
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>("[data-new-zone]")!.dispatchEvent(
      new CustomEvent("wt-change", { detail: { value: "Comedor" }, bubbles: true, composed: true }),
    );
    el.shadowRoot!.querySelector<HTMLElement>("[data-add-zone]")!.click();
    await flush(el);
    await expectNoA11yViolations(host);
  });
});
