import { LiveData } from "@waitron/dashboard-kit";
import { userEvent } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { chooseOption } from "@waitron/ui/src/test-helpers.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
import type { DashboardApi, DashboardTable, FloorZone } from "../api/client.js";
import { FloorScreen } from "./floor-screen.js";

const originalUrl = location.href;
afterEach(() => {
  cleanupWidgets();
  history.replaceState(null, "", originalUrl);
});

const ZONES: FloorZone[] = [{ id: "z1", name: "Comedor", displayOrder: 0, active: true }];

const TWO_ZONES: FloorZone[] = [
  ...ZONES,
  { id: "z2", name: "Terraza", displayOrder: 1, active: true },
];

const TABLES: DashboardTable[] = [
  {
    id: "t1",
    label: "4",
    zoneId: null,
    capacity: null,
    active: true,
    createdAt: "2026-08-17T00:00:00Z",
  },
];

const TWO_TABLES: DashboardTable[] = [
  {
    id: "t1",
    label: "4",
    zoneId: null,
    capacity: 2,
    active: true,
    createdAt: "2026-08-17T00:00:00Z",
  },
  {
    id: "t2",
    label: "5",
    zoneId: "z1",
    capacity: 4,
    active: true,
    createdAt: "2026-08-17T00:00:00Z",
  },
];

function stubApi(
  overrides: Partial<DashboardApi> = {},
  zones: FloorZone[] = ZONES,
  tables: DashboardTable[] = TABLES,
): DashboardApi {
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
    ...overrides,
  } as unknown as DashboardApi;
}

async function flush(el: FloorScreen): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
}

const q = (el: FloorScreen, sel: string) => el.shadowRoot!.querySelector<HTMLElement>(sel);
type Dropdown = HTMLElement & {
  options: { value: string; label: string }[];
  value: string;
  updateComplete: Promise<unknown>;
};
const errorKey = (el: FloorScreen): string | null =>
  (el as unknown as { errorKey: string | null }).errorKey;

function type(el: FloorScreen, sel: string, value: string): void {
  q(el, sel)!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
}

function selectValue(el: FloorScreen, sel: string, value: string): void {
  void chooseOption(q(el, sel)!, value);
}

describe("floor-screen", () => {
  it("loads zones for table placement and lists tables on connect", async () => {
    const api = stubApi();
    const { el } = await mountWidget<FloorScreen>("dashboard-floor-screen", { api });
    await flush(el);
    expect(api.listZones).toHaveBeenCalledTimes(1);
    expect(api.listTables).toHaveBeenCalledTimes(1);
    expect((q(el, "[data-test=table-zone-t1]") as Dropdown).options).toContainEqual({
      value: "z1",
      label: "Comedor",
    });
    expect(q(el, "[data-test=table-row-t1]")).not.toBeNull();
    expect(el.shadowRoot!.querySelectorAll("h1").length).toBe(1);
  });

  it("places tables in existing zones without offering zone creation on Floor", async () => {
    const api = stubApi();
    const { el } = await mountWidget<FloorScreen>("dashboard-floor-screen", { api });
    await flush(el);

    expect(q(el, "[data-new-zone]")).toBeNull();
    expect(q(el, "[data-add-zone]")).toBeNull();
    expect(q(el, "[data-test=zone-name-z1]")).toBeNull();
    expect(q(el, "[data-test=zone-save-z1]")).toBeNull();
    expect(q(el, "[data-test=zone-deactivate-z1]")).toBeNull();
    expect(q(el, "[data-test=table-zone-t1]")).not.toBeNull();
  });

  it("assigns a table's zone (updateTable with only the zoneId), then reloads", async () => {
    const api = stubApi();
    const { el } = await mountWidget<FloorScreen>("dashboard-floor-screen", { api });
    await flush(el);
    selectValue(el, "[data-test=table-zone-t1]", "z1");
    await flush(el);
    expect(api.updateTable).toHaveBeenCalledWith("t1", { zoneId: "z1" });
    expect(api.listTables).toHaveBeenCalledTimes(2);
  });

  it("picks a table's zone from a dropdown labelled with the field, prompting No zone while it has none", async () => {
    const api = stubApi({}, TWO_ZONES, TWO_TABLES);
    const { el } = await mountWidget<FloorScreen>("dashboard-floor-screen", { api });
    await flush(el);
    const zone = q(el, "wt-combobox[data-test=table-zone-t1]") as HTMLElement & {
      options: { value: string; label: string }[];
      value: string;
      label: string;
      placeholder: string;
      name: string;
    };
    expect(zone.name).toBe("table-zone");
    expect(zone.label).toBe(t("floor.table_zone"));
    expect(zone.placeholder).toBe(t("floor.no_zone"));
    expect(zone.options).toEqual([
      { value: "", label: t("floor.no_zone") },
      { value: "z1", label: "Comedor" },
      { value: "z2", label: "Terraza" },
    ]);
    expect(zone.value).toBe("");
    await chooseOption(zone, "z2");
    await flush(el);
    expect(api.updateTable).toHaveBeenCalledWith("t1", { zoneId: "z2" });
  });

  it("offers no blank clear option once a table has a zone (the dropdown can never show a fake unassigned state)", async () => {
    const api = stubApi({}, ZONES, TWO_TABLES);
    const { el } = await mountWidget<FloorScreen>("dashboard-floor-screen", { api });
    await flush(el);
    const select = q(el, "[data-test=table-zone-t2]") as Dropdown;
    const values = Array.from(select.options).map((o) => o.value);
    expect(values).not.toContain("");
    expect(select.value).toBe("z1");
  });

  it("shows the blank placeholder for an unassigned table, and picking it is a true no-op", async () => {
    const api = stubApi();
    const { el } = await mountWidget<FloorScreen>("dashboard-floor-screen", { api });
    await flush(el);
    const select = q(el, "[data-test=table-zone-t1]") as Dropdown;
    expect(Array.from(select.options).map((o) => o.value)).toContain("");
    expect(select.value).toBe("");
    selectValue(el, "[data-test=table-zone-t1]", "");
    await flush(el);
    expect(api.updateTable).not.toHaveBeenCalled();
    expect((q(el, "[data-test=table-zone-t1]") as Dropdown).value).toBe("");
  });

  it("saves an edited table row (updateTable with the row's label + capacity), then reloads", async () => {
    const api = stubApi({}, ZONES, TWO_TABLES);
    const { el } = await mountWidget<FloorScreen>("dashboard-floor-screen", { api });
    await flush(el);
    type(el, "[data-test=table-label-t1]", "6");
    type(el, "[data-test=table-capacity-t1]", "x");
    type(el, "[data-test=table-capacity-t1]", "");
    type(el, "[data-test=table-capacity-t1]", "8");
    q(el, "[data-test=table-save-t1]")!.click();
    await flush(el);
    expect(api.updateTable).toHaveBeenCalledTimes(1);
    expect(api.updateTable).toHaveBeenCalledWith("t1", { label: "6", capacity: 8 });
    expect(api.listTables).toHaveBeenCalledTimes(2);
  });

  it("saves a table whose capacity is left blank (updateTable with the label only)", async () => {
    const api = stubApi();
    const { el } = await mountWidget<FloorScreen>("dashboard-floor-screen", { api });
    await flush(el);
    type(el, "[data-test=table-label-t1]", "9");
    q(el, "[data-test=table-save-t1]")!.click();
    await flush(el);
    expect(api.updateTable).toHaveBeenCalledWith("t1", { label: "9" });
  });

  it("creates a table from the new-table form (createTable with the label), then reloads", async () => {
    const api = stubApi();
    const { el } = await mountWidget<FloorScreen>("dashboard-floor-screen", { api });
    await flush(el);
    type(el, "[data-new-table]", "7");
    q(el, "[data-add-table]")!.click();
    await flush(el);
    expect(api.createTable).toHaveBeenCalledWith({ label: "7" });
    expect(api.listTables).toHaveBeenCalledTimes(2);
  });

  it("does not create an empty-label table", async () => {
    const api = stubApi();
    const { el } = await mountWidget<FloorScreen>("dashboard-floor-screen", { api });
    await flush(el);
    q(el, "[data-add-table]")!.click();
    await flush(el);
    expect(api.createTable).not.toHaveBeenCalled();
  });

  it.each([
    ["es-ES", "Deshabilitar"],
    ["en-GB", "Disable"],
  ])("in %s, labels a table's switch-off Disable", async (locale, label) => {
    setLocale(locale);
    try {
      const { el } = await mountWidget<FloorScreen>("dashboard-floor-screen", { api: stubApi() });
      await flush(el);
      expect(q(el, "[data-test=table-deactivate-t1]")!.textContent!.trim()).toBe(label);
    } finally {
      setLocale("es-ES");
    }
  });

  it("disables a table row", async () => {
    const api = stubApi();
    const { el } = await mountWidget<FloorScreen>("dashboard-floor-screen", { api });
    await flush(el);
    q(el, "[data-test=table-deactivate-t1]")!.click();
    await flush(el);
    expect(api.deactivateTable).toHaveBeenCalledWith("t1");
    expect(api.listTables).toHaveBeenCalledTimes(2);
  });

  it("surfaces a rejected table create as a localised role=alert (never the raw code)", async () => {
    const api = stubApi({ createTable: vi.fn().mockRejectedValue({ code: "table.label_taken" }) });
    const { el } = await mountWidget<FloorScreen>("dashboard-floor-screen", { api });
    await flush(el);
    type(el, "[data-new-table]", "4");
    q(el, "[data-add-table]")!.click();
    await flush(el);
    expect(errorKey(el)).toBe("table.label_taken");
    const banner = q(el, "[role=alert]")?.textContent;
    expect(banner).toContain(codeMessage("table.label_taken", "es-ES"));
    expect(banner).not.toContain("table.label_taken");
  });

  it("surfaces a rejected table zone-assign as a localised role=alert", async () => {
    const api = stubApi({ updateTable: vi.fn().mockRejectedValue({ code: "table.not_found" }) });
    const { el } = await mountWidget<FloorScreen>("dashboard-floor-screen", { api });
    await flush(el);
    selectValue(el, "[data-test=table-zone-t1]", "z1");
    await flush(el);
    expect(errorKey(el)).toBe("table.not_found");
    const banner = q(el, "[role=alert]")?.textContent;
    expect(banner).toContain(codeMessage("table.not_found", "es-ES"));
  });

  it("shows the table's stored zone again after a refused change", async () => {
    const api = stubApi(
      { updateTable: vi.fn().mockRejectedValue({ code: "table.not_found" }) },
      TWO_ZONES,
      TWO_TABLES,
    );
    const { el } = await mountWidget<FloorScreen>("dashboard-floor-screen", { api });
    await flush(el);
    const zone = q(el, "wt-combobox[data-test=table-zone-t2]") as Dropdown;
    await chooseOption(zone, "z2");
    await flush(el);
    expect(errorKey(el)).toBe("table.not_found");
    await zone.updateComplete;
    expect(zone.value).toBe("z1");
    expect(zone.shadowRoot!.querySelector(".trigger .value")!.textContent!.trim()).toBe("Comedor");
  });

  it("surfaces a rejected table create as a localised role=alert", async () => {
    const api = stubApi({ createTable: vi.fn().mockRejectedValue({ code: "table.label_taken" }) });
    const { el } = await mountWidget<FloorScreen>("dashboard-floor-screen", { api });
    await flush(el);
    type(el, "[data-new-table]", "4");
    q(el, "[data-add-table]")!.click();
    await flush(el);
    expect(errorKey(el)).toBe("table.label_taken");
    const banner = q(el, "[role=alert]")?.textContent;
    expect(banner).toContain(codeMessage("table.label_taken", "es-ES"));
  });

  it("surfaces a rejected table save as a localised role=alert", async () => {
    const api = stubApi({ updateTable: vi.fn().mockRejectedValue({ code: "table.label_taken" }) });
    const { el } = await mountWidget<FloorScreen>("dashboard-floor-screen", { api });
    await flush(el);
    type(el, "[data-test=table-label-t1]", "4");
    q(el, "[data-test=table-save-t1]")!.click();
    await flush(el);
    expect(errorKey(el)).toBe("table.label_taken");
    const banner = q(el, "[role=alert]")?.textContent;
    expect(banner).toContain(codeMessage("table.label_taken", "es-ES"));
  });

  it("surfaces a rejected table disable as a localised role=alert", async () => {
    const api = stubApi({
      deactivateTable: vi.fn().mockRejectedValue({ code: "table.not_found" }),
    });
    const { el } = await mountWidget<FloorScreen>("dashboard-floor-screen", { api });
    await flush(el);
    q(el, "[data-test=table-deactivate-t1]")!.click();
    await flush(el);
    expect(errorKey(el)).toBe("table.not_found");
    const banner = q(el, "[role=alert]")?.textContent;
    expect(banner).toContain(codeMessage("table.not_found", "es-ES"));
  });

  it("falls back to server.internal when a rejected mutation carries no code", async () => {
    const api = stubApi({ createTable: vi.fn().mockRejectedValue({}) });
    const { el } = await mountWidget<FloorScreen>("dashboard-floor-screen", { api });
    await flush(el);
    type(el, "[data-new-table]", "Whatever");
    q(el, "[data-add-table]")!.click();
    await flush(el);
    expect(errorKey(el)).toBe("server.internal");
  });

  it("a rejected initial load shows the error banner and does not throw", async () => {
    const api = stubApi({ listZones: vi.fn().mockRejectedValue({ code: "server.internal" }) });
    const { el } = await mountWidget<FloorScreen>("dashboard-floor-screen", { api });
    await flush(el);
    expect(errorKey(el)).toBe("server.internal");
  });

  it("field-change events do not leak past the host (stopPropagation)", async () => {
    const api = stubApi();
    const { el, host } = await mountWidget<FloorScreen>("dashboard-floor-screen", { api });
    await flush(el);
    let leaked = false;
    host.addEventListener("wt-change", () => (leaked = true));
    type(el, "[data-new-table]", "Z");
    type(el, "[data-test=table-label-t1]", "W");
    expect(leaked).toBe(false);
  });
});

describe("floor-screen — enabling a disabled table", () => {
  const MIXED: DashboardTable[] = [
    { ...TWO_TABLES[0]!, posX: 100, posY: 100, shape: "round", rotation: 0 },
    { ...TWO_TABLES[1]!, active: false, posX: 300, posY: 300, shape: "square", rotation: 0 },
  ];
  const ENABLED: DashboardTable[] = MIXED.map((table) => ({ ...table, active: true }));

  it("reads the tables with the disabled ones too", async () => {
    const api = stubApi({}, ZONES, MIXED);
    const { el } = await mountWidget<FloorScreen>("dashboard-floor-screen", { api });
    await flush(el);
    expect(api.listTables).toHaveBeenCalledWith({ includeDisabled: true });
    expect(q(el, "[data-test=table-row-t2]")).not.toBeNull();
  });

  it("offers Enable, not Disable, on a disabled table and marks it Disabled; an active one still offers Disable", async () => {
    setLocale("en-GB");
    try {
      const { el } = await mountWidget<FloorScreen>("dashboard-floor-screen", {
        api: stubApi({}, ZONES, MIXED),
      });
      await flush(el);
      expect(q(el, "[data-test=table-deactivate-t2]")).toBeNull();
      expect(q(el, "[data-test=table-enable-t2]")!.textContent!.trim()).toBe("Enable");
      expect(q(el, "[data-test=table-status-t2]")!.textContent!.trim()).toBe("Disabled");
      expect(q(el, "[data-test=table-enable-t1]")).toBeNull();
      expect(q(el, "[data-test=table-status-t1]")).toBeNull();
      expect(q(el, "[data-test=table-deactivate-t1]")!.textContent!.trim()).toBe("Disable");
    } finally {
      setLocale("es-ES");
    }
  });

  it("in Spanish, says Habilitar and Deshabilitada", async () => {
    const { el } = await mountWidget<FloorScreen>("dashboard-floor-screen", {
      api: stubApi({}, ZONES, MIXED),
    });
    await flush(el);
    expect(q(el, "[data-test=table-enable-t2]")!.textContent!.trim()).toBe("Habilitar");
    expect(q(el, "[data-test=table-status-t2]")!.textContent!.trim()).toBe("Deshabilitada");
  });

  it("sends active: true for that table, then shows it active with Disable again", async () => {
    const listTables = vi
      .fn()
      .mockResolvedValueOnce(MIXED.map((table) => ({ ...table })))
      .mockResolvedValue(ENABLED.map((table) => ({ ...table })));
    const api = stubApi({ listTables }, ZONES, MIXED);
    const { el } = await mountWidget<FloorScreen>("dashboard-floor-screen", { api });
    await flush(el);
    q(el, "[data-test=table-enable-t2]")!.click();
    await flush(el);
    expect(api.updateTable).toHaveBeenCalledExactlyOnceWith("t2", { active: true });
    expect(listTables).toHaveBeenCalledTimes(2);
    await vi.waitFor(() => expect(q(el, "[data-test=table-enable-t2]")).toBeNull());
    expect(q(el, "[data-test=table-status-t2]")).toBeNull();
    expect(q(el, "[data-test=table-deactivate-t2]")).not.toBeNull();
    expect(q(el, "[role=alert]")).toBeNull();
  });

  it("shows a refused Enable as a localised alert and leaves the table disabled", async () => {
    const api = stubApi(
      { updateTable: vi.fn().mockRejectedValue({ code: "table.not_found" }) },
      ZONES,
      MIXED,
    );
    const { el } = await mountWidget<FloorScreen>("dashboard-floor-screen", { api });
    await flush(el);
    q(el, "[data-test=table-enable-t2]")!.click();
    await flush(el);
    expect(q(el, "[role=alert]")!.textContent).toContain(codeMessage("table.not_found", "es-ES"));
    expect(q(el, "[data-test=table-enable-t2]")).not.toBeNull();
    expect(api.listTables).toHaveBeenCalledTimes(1);
  });

  it("leaves a disabled table off the plan's canvas and tray", async () => {
    const api = stubApi({}, ZONES, [
      ...MIXED,
      { ...TWO_TABLES[1]!, id: "t3", label: "6", active: false },
      { ...MIXED[1]!, id: "t4", label: "7", active: true, posX: 600 },
    ]);
    const { el } = await mountWidget<FloorScreen>("dashboard-floor-screen", { api });
    await flush(el);
    q(el, '[data-tab="plano"]')!.dispatchEvent(new Event("click"));
    await el.updateComplete;
    const canvas = q(el, "wt-floor-canvas") as HTMLElement & {
      updateComplete: Promise<unknown>;
    };
    await canvas.updateComplete;
    // Comedor is the first zone tab; t1 has no zone, so it is on "Sin zona".
    expect(canvas.shadowRoot!.querySelector('[data-table="t4"]')).not.toBeNull();
    expect(canvas.shadowRoot!.querySelector('[data-table="t2"]')).toBeNull();
    expect(q(el, '[data-tray-table="t3"]')).toBeNull();
  });
});

describe("floor-screen — Plano editor (FP-2)", () => {
  const Z1_TABLES: DashboardTable[] = [
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

  type Canvas = HTMLElement & {
    editable: boolean;
    shadowRoot: ShadowRoot;
    updateComplete: Promise<unknown>;
  };
  const canvasOf = (el: FloorScreen): Canvas => q(el, "wt-floor-canvas") as Canvas;

  async function openPlano(el: FloorScreen): Promise<void> {
    q(el, '[data-tab="plano"]')!.dispatchEvent(new Event("click"));
    await el.updateComplete;
  }

  it("hosts an editable wt-floor-canvas on the Plano tab (and not on the default config tab)", async () => {
    const api = stubApi({}, ZONES, Z1_TABLES);
    const { el } = await mountWidget<FloorScreen>("dashboard-floor-screen", { api });
    await flush(el);
    expect(canvasOf(el)).toBeNull();
    expect(q(el, "[data-test=tables-panel]")).not.toBeNull();
    await openPlano(el);
    const canvas = canvasOf(el);
    expect(canvas).not.toBeNull();
    expect(canvas.editable).toBe(true);
    expect(q(el, "[data-test=tables-panel]")).toBeNull();
  });

  it("draws a placed table on the canvas and lists an unplaced one in the tray", async () => {
    const api = stubApi({}, ZONES, Z1_TABLES);
    const { el } = await mountWidget<FloorScreen>("dashboard-floor-screen", { api });
    await flush(el);
    await openPlano(el);
    const canvas = canvasOf(el);
    await canvas.updateComplete;
    expect(canvas.shadowRoot.querySelector('[data-table="t1"]')).not.toBeNull();
    expect(q(el, '[data-tray-table="t2"]')).not.toBeNull();
    expect(canvas.shadowRoot.querySelector('[data-table="t2"]')).toBeNull();
  });

  it("persists a placement-change via setTablePlacement, then reloads", async () => {
    const api = stubApi({}, ZONES, Z1_TABLES);
    const { el } = await mountWidget<FloorScreen>("dashboard-floor-screen", { api });
    await flush(el);
    await openPlano(el);
    canvasOf(el).dispatchEvent(
      new CustomEvent("wt-placement-change", {
        detail: { tableId: "t1", posX: 200, posY: 300, shape: "rect", rotation: 90, zoneId: "z1" },
        bubbles: true,
        composed: true,
      }),
    );
    await flush(el);
    expect(api.setTablePlacement).toHaveBeenCalledWith("t1", {
      posX: 200,
      posY: 300,
      shape: "rect",
      rotation: 90,
      zoneId: "z1",
    });
    expect(api.listTables).toHaveBeenCalledTimes(2);
    expect(api.listZones).toHaveBeenCalledOnce();
  });

  it("clears a placement via clearPlacement, then reloads", async () => {
    const api = stubApi({}, ZONES, Z1_TABLES);
    const { el } = await mountWidget<FloorScreen>("dashboard-floor-screen", { api });
    await flush(el);
    await openPlano(el);
    canvasOf(el).dispatchEvent(
      new CustomEvent("wt-placement-clear", {
        detail: { tableId: "t1" },
        bubbles: true,
        composed: true,
      }),
    );
    await flush(el);
    expect(api.clearPlacement).toHaveBeenCalledWith("t1");
    expect(api.listTables).toHaveBeenCalledTimes(2);
    expect(api.listZones).toHaveBeenCalledOnce();
  });

  it("surfaces a failed table reload after a placement write as the localised errorKey banner", async () => {
    const listTables = vi
      .fn()
      .mockResolvedValueOnce(Z1_TABLES.map((t) => ({ ...t })))
      .mockRejectedValueOnce({ code: "server.internal" });
    const api = stubApi({ listTables }, ZONES, Z1_TABLES);
    const { el } = await mountWidget<FloorScreen>("dashboard-floor-screen", { api });
    await flush(el);
    await openPlano(el);
    canvasOf(el).dispatchEvent(
      new CustomEvent("wt-placement-clear", {
        detail: { tableId: "t1" },
        bubbles: true,
        composed: true,
      }),
    );
    await flush(el);
    expect(api.clearPlacement).toHaveBeenCalledWith("t1");
    expect(errorKey(el)).toBe("server.internal");
    expect(q(el, "[role=alert]")?.textContent).toContain(codeMessage("server.internal", "es-ES"));
  });

  it("tap-to-places an unplaced tray table at a default position, then reloads", async () => {
    // With no placed tables the default slot is the centre.
    const only: DashboardTable[] = [Z1_TABLES[1]!];
    const api = stubApi({}, ZONES, only);
    const { el } = await mountWidget<FloorScreen>("dashboard-floor-screen", { api });
    await flush(el);
    await openPlano(el);
    q(el, '[data-tray-table="t2"]')!.click();
    await flush(el);
    expect(api.setTablePlacement).toHaveBeenCalledWith("t2", {
      posX: 500,
      posY: 500,
      shape: "round",
      rotation: 0,
      zoneId: "z1",
    });
    expect(api.listTables).toHaveBeenCalledTimes(2);
    expect(api.listZones).toHaveBeenCalledOnce();
  });

  it("surfaces a rejected placement (placement.invalid) as a localised role=alert, never the raw code", async () => {
    const api = stubApi(
      { setTablePlacement: vi.fn().mockRejectedValue({ code: "placement.invalid" }) },
      ZONES,
      Z1_TABLES,
    );
    const { el } = await mountWidget<FloorScreen>("dashboard-floor-screen", { api });
    await flush(el);
    await openPlano(el);
    canvasOf(el).dispatchEvent(
      new CustomEvent("wt-placement-change", {
        detail: { tableId: "t1", posX: 5000, posY: 0, shape: "round", rotation: 0, zoneId: "z1" },
        bubbles: true,
        composed: true,
      }),
    );
    await flush(el);
    expect(errorKey(el)).toBe("placement.invalid");
    const banner = q(el, "[role=alert]")?.textContent;
    expect(banner).toContain(codeMessage("placement.invalid", "es-ES"));
    expect(banner).not.toContain("placement.invalid");
  });

  it("surfaces a rejected placement-clear as a localised role=alert", async () => {
    const api = stubApi(
      { clearPlacement: vi.fn().mockRejectedValue({ code: "table.not_found" }) },
      ZONES,
      Z1_TABLES,
    );
    const { el } = await mountWidget<FloorScreen>("dashboard-floor-screen", { api });
    await flush(el);
    await openPlano(el);
    canvasOf(el).dispatchEvent(
      new CustomEvent("wt-placement-clear", {
        detail: { tableId: "t1" },
        bubbles: true,
        composed: true,
      }),
    );
    await flush(el);
    expect(errorKey(el)).toBe("table.not_found");
    expect(q(el, "[role=alert]")?.textContent).toContain(codeMessage("table.not_found", "es-ES"));
  });

  it("shows a Sin zona sub-tab and canvas for a zoneless placed table", async () => {
    const zoneless: DashboardTable[] = [
      {
        id: "t9",
        label: "9",
        zoneId: null,
        capacity: null,
        active: true,
        createdAt: "2026-08-17T00:00:00Z",
        posX: 100,
        posY: 100,
        shape: "square",
        rotation: 0,
      },
    ];
    const api = stubApi({}, ZONES, zoneless);
    const { el } = await mountWidget<FloorScreen>("dashboard-floor-screen", { api });
    await flush(el);
    await openPlano(el);
    q(el, '[data-zone="none"]')!.dispatchEvent(new Event("click"));
    await el.updateComplete;
    const canvas = canvasOf(el);
    await canvas.updateComplete;
    expect(canvas.shadowRoot.querySelector('[data-table="t9"]')).not.toBeNull();
  });

  it("switches the canvas contents when another zone sub-tab is picked", async () => {
    const spread: DashboardTable[] = [
      { ...Z1_TABLES[0]!, id: "t1", zoneId: "z1" },
      {
        id: "tB",
        label: "B",
        zoneId: "z2",
        capacity: 4,
        active: true,
        createdAt: "2026-08-17T00:00:00Z",
        posX: 600,
        posY: 600,
        shape: "rect",
        rotation: 0,
      },
    ];
    const api = stubApi({}, TWO_ZONES, spread);
    const { el } = await mountWidget<FloorScreen>("dashboard-floor-screen", { api });
    await flush(el);
    await openPlano(el);
    let canvas = canvasOf(el);
    await canvas.updateComplete;
    expect(canvas.shadowRoot.querySelector('[data-table="t1"]')).not.toBeNull();
    expect(canvas.shadowRoot.querySelector('[data-table="tB"]')).toBeNull();
    q(el, '[data-zone="z2"]')!.dispatchEvent(new Event("click"));
    await el.updateComplete;
    canvas = canvasOf(el);
    await canvas.updateComplete;
    expect(canvas.shadowRoot.querySelector('[data-table="tB"]')).not.toBeNull();
    expect(canvas.shadowRoot.querySelector('[data-table="t1"]')).toBeNull();
  });

  it("renders the Plano tab with no zones and no tables (empty canvas, no sub-tabs)", async () => {
    const api = stubApi({}, [], []);
    const { el } = await mountWidget<FloorScreen>("dashboard-floor-screen", { api });
    await flush(el);
    await openPlano(el);
    expect(canvasOf(el)).not.toBeNull();
    expect(q(el, "[data-zone]")).toBeNull();
    expect(q(el, "[data-tray-table]")).toBeNull();
  });
});

describe("floor URL tabs", () => {
  it("restores the plan and zone, records clicks, and follows history", async () => {
    const url = new URL(location.href);
    url.pathname = "/manage/floor/view/plano/zone/z2";
    history.replaceState(null, "", url);
    const { el } = await mountWidget<FloorScreen>("dashboard-floor-screen", {
      api: stubApi({}, TWO_ZONES),
    });
    await flush(el);
    expect(el.shadowRoot!.querySelector('[data-tab="plano"]')!.getAttribute("variant")).toBe(
      "primary",
    );
    expect(el.shadowRoot!.querySelector('[data-zone="z2"]')!.getAttribute("variant")).toBe(
      "primary",
    );
    el.shadowRoot!.querySelector<HTMLElement>('[data-tab="config"]')!.click();
    await el.updateComplete;
    expect(location.pathname).toBe("/manage/floor/view/config/zone/z2");
    const back = new Promise<void>((resolve) =>
      window.addEventListener("popstate", () => resolve(), { once: true }),
    );
    history.back();
    await back;
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector('[data-zone="z2"]')!.getAttribute("variant")).toBe(
      "primary",
    );
  });
});

it.each([
  {
    method: "createTable",
    field: "[data-new-table]",
    button: "[data-add-table]",
    result: { id: "t9" },
  },
  {
    method: "updateTable",
    field: "[data-test=table-label-t1]",
    button: "[data-test=table-save-t1]",
    result: null,
  },
])(
  "Enter guards pending $method and allows retry after rejection",
  async ({ method, field, button, result }) => {
    let reject!: (reason: unknown) => void;
    const pending = new Promise((_, fail) => {
      reject = fail;
    });
    const request = vi.fn().mockReturnValueOnce(pending).mockResolvedValue(result);
    const api = stubApi({ [method]: request });
    const { el } = await mountWidget<FloorScreen>("dashboard-floor-screen", { api });
    await flush(el);

    const control = el.shadowRoot!.querySelector<import("@waitron/ui").WtInput>(field)!;
    await control.updateComplete;
    const input = control.shadowRoot!.querySelector("input")!;
    input.value = "Updated";
    input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    await el.updateComplete;
    input.focus();
    await userEvent.keyboard("{Enter}");
    await userEvent.keyboard("{Enter}");
    el.shadowRoot!.querySelector<HTMLElement>(button)!.click();
    expect(request).toHaveBeenCalledTimes(1);
    expect((el.shadowRoot!.querySelector(button) as import("@waitron/ui").WtButton).disabled).toBe(
      true,
    );
    reject({ code: "management.request_invalid" });
    await flush(el);
    input.focus();
    await userEvent.keyboard("{Enter}");
    await flush(el);
    expect(request).toHaveBeenCalledTimes(2);
    expect((el.shadowRoot!.querySelector(button) as import("@waitron/ui").WtButton).disabled).toBe(
      false,
    );
  },
);

it("refreshes displayed tables when their data changes elsewhere", async () => {
  const liveData = new LiveData();
  const api = Object.assign(stubApi(), { liveData });
  const { el } = await mountWidget<HTMLElement & { api: DashboardApi }>("dashboard-floor-screen", {
    api,
  });
  const rows = (): unknown[] => (el as unknown as Record<string, unknown[]>)["tables"]!;
  await vi.waitFor(() => expect(rows()?.length).toBeGreaterThan(0));
  vi.mocked(api.listTables).mockResolvedValue([]);
  liveData.invalidate([{ type: "dining_tables", id: "changed-elsewhere" }]);
  await vi.waitFor(() => expect(rows()).toEqual([]));
  expect(api.listTables).toHaveBeenCalledTimes(2);
});

it("restores the Sin zona sub-tab from history", async () => {
  const url = new URL(location.href);
  url.pathname = "/manage/floor/view/plano/zone/z1";
  history.replaceState(null, "", url);
  const zoneless: DashboardTable = { ...TABLES[0]!, posX: 100, posY: 100, shape: "square" };
  const { el } = await mountWidget<FloorScreen>("dashboard-floor-screen", {
    api: stubApi({}, ZONES, [zoneless]),
  });
  await flush(el);
  q(el, '[data-zone="none"]')!.click();
  await el.updateComplete;
  q(el, '[data-zone="z1"]')!.click();
  await el.updateComplete;
  expect(q(el, '[data-zone="none"]')!.getAttribute("variant")).not.toBe("primary");
  const back = new Promise<void>((resolve) =>
    window.addEventListener("popstate", () => resolve(), { once: true }),
  );
  history.back();
  await back;
  await el.updateComplete;
  expect(q(el, '[data-zone="none"]')!.getAttribute("variant")).toBe("primary");
  expect(q(el, '[data-zone="z1"]')!.getAttribute("variant")).not.toBe("primary");
});

it.each([
  {
    method: "updateTable",
    field: "[data-test=table-capacity-t1]",
    value: "6",
    call: ["t1", { label: "4", capacity: 6 }],
  },
])(
  "Enter in a number field saves its row through $method",
  async ({ method, field, value, call }) => {
    const api = stubApi();
    const { el } = await mountWidget<FloorScreen>("dashboard-floor-screen", { api });
    await flush(el);
    const control = el.shadowRoot!.querySelector<import("@waitron/ui").WtInput>(field)!;
    await control.updateComplete;
    const input = control.shadowRoot!.querySelector("input")!;
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    await el.updateComplete;
    input.focus();
    await userEvent.keyboard("{Enter}");
    await flush(el);
    expect(api[method as "updateTable"]).toHaveBeenCalledExactlyOnceWith(...call);
  },
);

it.each([{ method: "updateTable", rows: "tables", button: "[data-test=table-save-t1]" }])(
  "a save landing before the re-render of a refresh that removed its row sends nothing ($method)",
  async ({ method, rows, button }) => {
    const api = stubApi();
    const { el } = await mountWidget<FloorScreen>("dashboard-floor-screen", { api });
    await flush(el);
    (el as unknown as Record<string, unknown[]>)[rows] = [];
    q(el, button)!.click();
    await flush(el);
    expect(api[method as "updateTable"]).not.toHaveBeenCalled();
    expect(errorKey(el)).toBeNull();
  },
);

it("clears a failed load's message once the server answers again", async () => {
  const liveData = new LiveData();
  const api = Object.assign(
    stubApi({
      listZones: vi
        .fn()
        .mockRejectedValueOnce({ code: "connection.failed" })
        .mockResolvedValue(ZONES.map((z) => ({ ...z }))),
    }),
    { liveData },
  );
  const { el } = await mountWidget<FloorScreen>("dashboard-floor-screen", { api });
  await vi.waitFor(() =>
    expect(q(el, "[role=alert]")?.textContent).toBe(codeMessage("connection.failed")),
  );
  liveData.refresh();
  await vi.waitFor(() => expect(q(el, "[role=alert]")).toBeNull());
  expect((q(el, "[data-test=table-zone-t1]") as Dropdown).options).toContainEqual({
    value: "z1",
    label: "Comedor",
  });
  expect(q(el, "[data-test=table-row-t1]")).not.toBeNull();
});

it("keeps an unsaved, typed table label through a failed read and its recovery", async () => {
  const liveData = new LiveData();
  const api = Object.assign(stubApi(), { liveData });
  const { el } = await mountWidget<FloorScreen>("dashboard-floor-screen", { api });
  await vi.waitFor(() => expect(q(el, "[data-test=table-row-t1]")).not.toBeNull());
  const innerInput = async (sel: string): Promise<HTMLInputElement> => {
    const control = el.shadowRoot!.querySelector<import("@waitron/ui").WtInput>(sel)!;
    await control.updateComplete;
    return control.shadowRoot!.querySelector("input")!;
  };
  const label = await innerInput("[data-test=table-label-t1]");
  label.value = "Mesa nueva";
  label.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  await el.updateComplete;

  vi.mocked(api.listTables).mockRejectedValue({ code: "connection.failed" });
  liveData.refresh();
  await vi.waitFor(() =>
    expect(q(el, "[role=alert]")?.textContent).toBe(codeMessage("connection.failed")),
  );
  vi.mocked(api.listTables).mockResolvedValue([{ ...TABLES[0]!, capacity: 3 }]);
  liveData.refresh();
  await vi.waitFor(() => expect(q(el, "[role=alert]")).toBeNull());

  expect((await innerInput("[data-test=table-capacity-t1]")).value).toBe("3");
  expect((await innerInput("[data-test=table-label-t1]")).value).toBe("Mesa nueva");
  expect(api.updateTable).not.toHaveBeenCalled();
});

it("keeps a save's connection failure when the reads that failed beside it recover", async () => {
  const liveData = new LiveData();
  const api = Object.assign(
    stubApi({ deactivateTable: vi.fn().mockRejectedValue({ code: "connection.failed" }) }),
    { liveData },
  );
  const { el } = await mountWidget<FloorScreen>("dashboard-floor-screen", { api });
  await vi.waitFor(() => expect(q(el, "[data-test=table-row-t1]")).not.toBeNull());

  vi.mocked(api.listZones).mockRejectedValue({ code: "connection.failed" });
  liveData.refresh();
  await vi.waitFor(() =>
    expect(q(el, "[role=alert]")?.textContent).toBe(codeMessage("connection.failed")),
  );
  q(el, "[data-test=table-deactivate-t1]")!.click();
  await vi.waitFor(() => expect(api.deactivateTable).toHaveBeenCalledTimes(1));
  await flush(el);
  const readsBefore = vi.mocked(api.listZones).mock.calls.length;
  liveData.refresh();
  await vi.waitFor(() =>
    expect(vi.mocked(api.listZones).mock.calls.length).toBeGreaterThan(readsBefore),
  );
  await flush(el);

  vi.mocked(api.listZones).mockResolvedValue(TWO_ZONES.map((z) => ({ ...z })));
  liveData.refresh();
  await vi.waitFor(() =>
    expect((q(el, "[data-test=table-zone-t1]") as Dropdown).options).toContainEqual({
      value: "z2",
      label: "Terraza",
    }),
  );
  await flush(el);
  expect(q(el, "[role=alert]")?.textContent).toBe(codeMessage("connection.failed"));
});

it("keeps a failed table deactivation when an earlier table creation completes after it", async () => {
  let finishCreate!: () => void;
  const api = stubApi({
    createTable: vi.fn().mockReturnValue(
      new Promise<void>((resolve) => {
        finishCreate = resolve;
      }),
    ),
    deactivateTable: vi.fn().mockRejectedValue({ code: "table.not_found" }),
  });
  const { el } = await mountWidget<FloorScreen>("dashboard-floor-screen", { api });
  await vi.waitFor(() => expect(q(el, "[data-test=table-row-t1]")).not.toBeNull());

  type(el, "[data-new-table]", "Mesa nueva");
  q(el, "[data-add-table]")!.click();
  await vi.waitFor(() => expect(api.createTable).toHaveBeenCalledTimes(1));
  q(el, "[data-test=table-deactivate-t1]")!.click();
  await vi.waitFor(() =>
    expect(q(el, "[role=alert]")?.textContent).toBe(codeMessage("table.not_found")),
  );

  const reads = vi.mocked(api.listZones).mock.calls.length;
  finishCreate();
  await vi.waitFor(() => expect(api.listZones).toHaveBeenCalledTimes(reads + 1));
  await flush(el);
  expect(q(el, "[role=alert]")?.textContent).toBe(codeMessage("table.not_found"));
});
