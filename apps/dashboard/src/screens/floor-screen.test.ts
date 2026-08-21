import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { codeMessage } from "../i18n/codes.js";
import type { DashboardApi, DashboardTable, FloorZone } from "../api/client.js";
import { FloorScreen } from "./floor-screen.js";

/**
 * The floor-plan config screen. Its `api` is a stub: `listZones`/`listTables` return known
 * lists the screen loads on connect, and the eight CRUD verbs are spies the per-item mutation paths
 * call (each followed by a reload). Assertions cover each behaviour on its own: the two panels LOAD
 * from `listZones`/`listTables`; the new-zone form calls `createZone({ name })` and reloads; an empty
 * name creates nothing; a zone-row edit calls `updateZone` with the row's CURRENT values and reloads;
 * a deactivate soft-deletes; assigning a table's zone calls `updateTable({ zoneId })`; a table-row
 * edit calls `updateTable({ label, capacity })`; and any rejected mutation/load surfaces a
 * `role="alert"` whose text is the LOCALISED copy for the code, never the raw wire code. Mirrors
 * `service-status-screen.test.ts`.
 */

afterEach(cleanupWidgets);

const ZONES: FloorZone[] = [{ id: "z1", name: "Comedor", displayOrder: 0, active: true }];

/** Two zones — a second so a per-row edit exercises the "leave the other rows alone" branch. */
const TWO_ZONES: FloorZone[] = [
  ...ZONES,
  { id: "z2", name: "Terraza", displayOrder: 1, active: true },
];

/** One table with a NULL zone + capacity (exercises the "— no zone —" / blank-capacity render). */
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

/** Two tables — a second (zoned + seated) so a per-row edit exercises the "leave the other row
 * alone" branch and the "zone already selected" render. */
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
    ...overrides,
  } as unknown as DashboardApi;
}

/** Settles the in-flight listZones/listTables and the follow-up render. */
async function flush(el: FloorScreen): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
}

const q = (el: FloorScreen, sel: string) => el.shadowRoot!.querySelector<HTMLElement>(sel);
const errorKey = (el: FloorScreen): string | null =>
  (el as unknown as { errorKey: string | null }).errorKey;

/** Fire a wt-input's composed change, exactly as `wt-input` dispatches it. */
function type(el: FloorScreen, sel: string, value: string): void {
  q(el, sel)!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
}

/** Set a native <select>'s value and fire its `change`, exactly as the browser does on a pick. */
function selectValue(el: FloorScreen, sel: string, value: string): void {
  const node = q(el, sel) as HTMLSelectElement;
  node.value = value;
  node.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
}

describe("floor-screen", () => {
  it("loads and lists the zones and tables on connect", async () => {
    const api = stubApi();
    const { el } = await mountWidget<FloorScreen>("dashboard-floor-screen", { api });
    await flush(el);
    expect(api.listZones).toHaveBeenCalledTimes(1);
    expect(api.listTables).toHaveBeenCalledTimes(1);
    expect(q(el, "[data-test=zone-row-z1]")).not.toBeNull();
    expect(q(el, "[data-test=table-row-t1]")).not.toBeNull();
    expect(el.shadowRoot!.querySelectorAll("h1").length).toBe(1);
  });

  it("creates a zone from the new-zone form (createZone with the name), then reloads", async () => {
    const api = stubApi();
    const { el } = await mountWidget<FloorScreen>("dashboard-floor-screen", { api });
    await flush(el);
    type(el, "[data-new-zone]", "Comedor");
    q(el, "[data-add-zone]")!.click();
    await flush(el);
    expect(api.createZone).toHaveBeenCalledWith({ name: "Comedor" });
    expect(api.listZones).toHaveBeenCalledTimes(2); // initial + reload after create
  });

  it("does not create an empty-name zone", async () => {
    const api = stubApi();
    const { el } = await mountWidget<FloorScreen>("dashboard-floor-screen", { api });
    await flush(el);
    q(el, "[data-add-zone]")!.click();
    await flush(el);
    expect(api.createZone).not.toHaveBeenCalled();
  });

  it("saves an edited zone row (updateZone with the row's current name + order), then reloads", async () => {
    // Two rows, so editing z1 also exercises the "leave the other row untouched" map branch.
    const api = stubApi({}, TWO_ZONES);
    const { el } = await mountWidget<FloorScreen>("dashboard-floor-screen", { api });
    await flush(el);
    type(el, "[data-test=zone-name-z1]", "Salón");
    // A non-numeric order coerces to 0 (the falsy `|| 0` branch); then a real number.
    type(el, "[data-test=zone-order-z1]", "x");
    type(el, "[data-test=zone-order-z1]", "2");
    q(el, "[data-test=zone-save-z1]")!.click();
    await flush(el);
    expect(api.updateZone).toHaveBeenCalledTimes(1);
    expect(api.updateZone).toHaveBeenCalledWith("z1", { name: "Salón", displayOrder: 2 });
    expect(api.listZones).toHaveBeenCalledTimes(2);
  });

  it("deactivates a zone row", async () => {
    const api = stubApi();
    const { el } = await mountWidget<FloorScreen>("dashboard-floor-screen", { api });
    await flush(el);
    q(el, "[data-test=zone-deactivate-z1]")!.click();
    await flush(el);
    expect(api.deactivateZone).toHaveBeenCalledWith("z1");
    expect(api.listZones).toHaveBeenCalledTimes(2);
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

  it("offers no blank clear option once a table has a zone (the select can never show a fake unassigned state)", async () => {
    // t2 is already in z1. Clearing a zone is not supported server-side, so a blank/"sin zona" option
    // that would visually clear it (while the assignment stays) must not be selectable — the select
    // shows only real zones, with the current one selected.
    const api = stubApi({}, ZONES, TWO_TABLES);
    const { el } = await mountWidget<FloorScreen>("dashboard-floor-screen", { api });
    await flush(el);
    const select = q(el, "[data-test=table-zone-t2]") as HTMLSelectElement;
    const values = Array.from(select.options).map((o) => o.value);
    expect(values).not.toContain(""); // no blank-clear option for an assigned table
    expect(select.value).toBe("z1"); // the select reflects the real, still-assigned zone
  });

  it("shows the blank placeholder for an unassigned table, and picking it is a true no-op", async () => {
    // t1 has no zone: the blank "— no zone —" IS its genuine current state, so it is offered and
    // selected. Picking it again changes nothing and never calls updateTable (the route takes no null),
    // and the select still reflects the real unassigned state (no desync).
    const api = stubApi();
    const { el } = await mountWidget<FloorScreen>("dashboard-floor-screen", { api });
    await flush(el);
    const select = q(el, "[data-test=table-zone-t1]") as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.value)).toContain("");
    expect(select.value).toBe("");
    selectValue(el, "[data-test=table-zone-t1]", "");
    await flush(el);
    expect(api.updateTable).not.toHaveBeenCalled();
    expect((q(el, "[data-test=table-zone-t1]") as HTMLSelectElement).value).toBe("");
  });

  it("saves an edited table row (updateTable with the row's label + capacity), then reloads", async () => {
    // Two rows, so editing t1 also exercises the "leave the other row untouched" map branch.
    const api = stubApi({}, ZONES, TWO_TABLES);
    const { el } = await mountWidget<FloorScreen>("dashboard-floor-screen", { api });
    await flush(el);
    type(el, "[data-test=table-label-t1]", "6");
    // Non-numeric → 0 (the `|| 0` branch); blank → null (the "clear capacity" branch); then a number.
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
    // t1's capacity is null; editing only the label sends no capacity key at all.
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

  it("deactivates a table row", async () => {
    const api = stubApi();
    const { el } = await mountWidget<FloorScreen>("dashboard-floor-screen", { api });
    await flush(el);
    q(el, "[data-test=table-deactivate-t1]")!.click();
    await flush(el);
    expect(api.deactivateTable).toHaveBeenCalledWith("t1");
    expect(api.listTables).toHaveBeenCalledTimes(2);
  });

  it("surfaces a rejected zone create as a localised role=alert (never the raw code)", async () => {
    const api = stubApi({ createZone: vi.fn().mockRejectedValue({ code: "zone.name_taken" }) });
    const { el } = await mountWidget<FloorScreen>("dashboard-floor-screen", { api });
    await flush(el);
    type(el, "[data-new-zone]", "Comedor");
    q(el, "[data-add-zone]")!.click();
    await flush(el);
    expect(errorKey(el)).toBe("zone.name_taken");
    const banner = q(el, "[role=alert]")?.textContent;
    expect(banner).toContain(codeMessage("zone.name_taken", "es-ES"));
    expect(banner).not.toContain("zone.name_taken");
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

  it("surfaces a rejected zone deactivate as a localised role=alert", async () => {
    const api = stubApi({ deactivateZone: vi.fn().mockRejectedValue({ code: "zone.not_found" }) });
    const { el } = await mountWidget<FloorScreen>("dashboard-floor-screen", { api });
    await flush(el);
    q(el, "[data-test=zone-deactivate-z1]")!.click();
    await flush(el);
    expect(errorKey(el)).toBe("zone.not_found");
    const banner = q(el, "[role=alert]")?.textContent;
    expect(banner).toContain(codeMessage("zone.not_found", "es-ES"));
  });

  it("surfaces a rejected zone save as a localised role=alert", async () => {
    const api = stubApi({ updateZone: vi.fn().mockRejectedValue({ code: "zone.not_found" }) });
    const { el } = await mountWidget<FloorScreen>("dashboard-floor-screen", { api });
    await flush(el);
    type(el, "[data-test=zone-name-z1]", "Salón");
    q(el, "[data-test=zone-save-z1]")!.click();
    await flush(el);
    expect(errorKey(el)).toBe("zone.not_found");
    const banner = q(el, "[role=alert]")?.textContent;
    expect(banner).toContain(codeMessage("zone.not_found", "es-ES"));
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

  it("surfaces a rejected table deactivate as a localised role=alert", async () => {
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
    const api = stubApi({ createZone: vi.fn().mockRejectedValue({}) });
    const { el } = await mountWidget<FloorScreen>("dashboard-floor-screen", { api });
    await flush(el);
    type(el, "[data-new-zone]", "Whatever");
    q(el, "[data-add-zone]")!.click();
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
    type(el, "[data-new-zone]", "X");
    type(el, "[data-test=zone-name-z1]", "Y");
    type(el, "[data-new-table]", "Z");
    type(el, "[data-test=table-label-t1]", "W");
    expect(leaked).toBe(false);
  });
});
