import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { setLocale, type DashboardRequest } from "@waitron/dashboard-kit";
import { cleanup, mount } from "@waitron/ui/src/test-helpers.js";
import { VenueServiceApi, type FloorZone, type VenueServiceView } from "./client.js";
import { zonesModel } from "../testing/department-zones-fixture.js";
import "./departments-list.js";
beforeEach(() => {
  setLocale("en");
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => {
  cleanup();
  setLocale("en");
  localStorage.clear();
  sessionStorage.clear();
});
async function setup(request?: DashboardRequest) {
  const el = (await mount(
    "<departments-list></departments-list>",
  )) as HTMLElementTagNameMap["departments-list"];
  el.model = structuredClone(zonesModel);
  Object.assign(el, {
    api: new VenueServiceApi(request ?? ((async () => ({ tables: [] })) as DashboardRequest)),
  });
  await el.updateComplete;
  const table = el.shadowRoot!.querySelector("wt-data-table")!;
  await table.updateComplete;
  return { el, table };
}
it("keeps departments expanded with each active zone indented below its owning row", async () => {
  const { table } = await setup();
  expect(table.columns.map(({ key }) => key)).toEqual([
    "name",
    "orderStart",
    "paidWhen",
    "actions",
  ]);
  expect(table.columns.at(-1)).toMatchObject({ key: "actions", pinned: "end" });
  expect(
    [...table.shadowRoot!.querySelectorAll("tbody tr")].map((row) => [
      row.getAttribute("data-row-key"),
      row.getAttribute("aria-level"),
    ]),
  ).toEqual([
    ["department:d1", "1"],
    ["zone:z1", "2"],
    ["zone:z2", "2"],
    ["zone:z3", "2"],
    ["department:d2", "1"],
    ["zone:z4", "2"],
  ]);
  expect(table.shadowRoot!.querySelectorAll(".tree-toggle")).toHaveLength(0);
  expect(table.shadowRoot!.querySelectorAll("[data-test^=zone-grip-]")).toHaveLength(4);
});
function policyCells(table: Element) {
  return Object.fromEntries(
    [...table.shadowRoot!.querySelectorAll("tbody tr")].map((row) => [
      row.getAttribute("data-row-key"),
      [...row.querySelectorAll("td")].slice(1, 3).map((cell) => cell.textContent!.trim()),
    ]),
  );
}
it("leaves a zone's value blank where it matches its department's, and counter-service timing blank on a table-service row", async () => {
  const { table } = await setup();
  expect(policyCells(table)).toEqual({
    "department:d1": ["Table service", "Paid before preparation"],
    "zone:z1": ["Counter service", ""],
    "zone:z2": ["", ""],
    "zone:z3": ["", ""],
    "department:d2": ["Counter service", "Paid before preparation"],
    "zone:z4": ["", ""],
  });
  expect(table.shadowRoot!.querySelectorAll("[part~=inherited]")).toHaveLength(0);
  for (const policy of table.shadowRoot!.querySelectorAll("[part~=policy]"))
    expect(getComputedStyle(policy).fontStyle).toBe("normal");
});
it("shows a counter-service zone's own timing, and leaves a table-service department's blank once no zone uses counter service", async () => {
  const { el, table } = await setup();
  const zones = el.model!.salePolicies.zones;
  el.model = {
    ...el.model!,
    salePolicies: {
      ...el.model!.salePolicies,
      zones: zones.map((zone) =>
        zone.zoneId === "z1"
          ? { ...zone, orderStart: null, effective: { ...zone.effective, orderStart: "table" } }
          : zone,
      ),
    },
  };
  await el.updateComplete;
  await table.updateComplete;
  expect(policyCells(table)["department:d1"]).toEqual(["Table service", ""]);
  expect(policyCells(table)["zone:z1"]).toEqual(["", ""]);
  el.model = {
    ...el.model,
    salePolicies: {
      ...el.model.salePolicies,
      zones: zones.map((zone) =>
        zone.zoneId === "z1"
          ? {
              ...zone,
              paidWhen: "ticket_then_pay",
              effective: { ...zone.effective, paidWhen: "ticket_then_pay" },
            }
          : zone,
      ),
    },
  };
  await el.updateComplete;
  await table.updateComplete;
  expect(policyCells(table)["department:d1"]).toEqual(["Table service", "Paid before preparation"]);
  expect(policyCells(table)["zone:z1"]).toEqual(["Counter service", "Paid at collection"]);
});
it("each row opens its own editor and department menus offer Edit, Add a zone and Delete", async () => {
  const { el, table } = await setup();
  const opened = vi.fn(),
    zone = vi.fn();
  el.addEventListener("open-department", opened);
  el.addEventListener("edit-zone", zone);
  expect(
    table.shadowRoot!.querySelector('[data-row-key="zone:z1"]'),
    "the editable zone row is shown",
  ).not.toBeNull();
  await userEvent.click(
    table.shadowRoot!.querySelector('[data-row-key="department:d1"] .row-activate')!,
  );
  await userEvent.click(table.shadowRoot!.querySelector('[data-row-key="zone:z1"] .row-activate')!);
  expect(opened.mock.calls.map(([event]) => (event as CustomEvent).detail)).toEqual([
    { departmentId: "d1" },
  ]);
  expect(zone.mock.calls.map(([event]) => (event as CustomEvent).detail)).toEqual([
    { zoneId: "z1" },
  ]);
  const menu = table.shadowRoot!.querySelector('[data-row-key="department:d1"] wt-row-actions')!;
  expect(
    [...menu.querySelectorAll("wt-button")].map((button) => button.textContent!.trim()),
  ).toEqual(["Edit", "Add zone", "Delete"]);
  expect(menu.querySelector('[data-test="receipt-department-d1"]')).toBeNull();
});

it("names a missing department description and asks for it without activating the row", async () => {
  const { el, table } = await setup();
  el.model!.readiness.push(
    Object.assign(
      {},
      {
        code: "department.operation_description_required" as const,
        departmentId: "d1",
        departmentName: "Restaurant",
      },
    ),
  );
  el.requestUpdate();
  await el.updateComplete;
  await table.updateComplete;
  const row = table.shadowRoot!.querySelector('[data-row-key="department:d1"]')!;
  expect(row.textContent).toContain("Set up the tax-agency description");
  const description = vi.fn(),
    edit = vi.fn();
  el.addEventListener("edit-description", description);
  el.addEventListener("open-department", edit);
  const action = row.querySelector<HTMLElement>("[data-test=description-setup-d1]");
  expect(action, "missing-description setup offers its description field").not.toBeNull();
  await userEvent.click(action!);
  expect(description.mock.calls.map(([event]) => (event as CustomEvent).detail)).toEqual([
    { departmentId: "d1" },
  ]);
  expect(edit).not.toHaveBeenCalled();
  el.receiptAvailable = () => false;
  await el.updateComplete;
  await table.updateComplete;
  expect(row.textContent).toContain("Set up the tax-agency description");
  expect(row.querySelector("[data-test=description-setup-d1]")).toBeNull();
});

async function withFloorZones(floorZones: FloorZone[]) {
  const { el, table } = await setup();
  el.model = { ...el.model!, floorZones };
  await el.updateComplete;
  await table.updateComplete;
  return { el, table };
}

it("a department row has no Receipt link and the description button asks for the description", async () => {
  const { el, table } = await setup();
  expect(table.shadowRoot!.querySelector('[data-test^="receipt-department-"]')).toBeNull();
  el.model!.readiness.push({
    code: "department.operation_description_required",
    departmentId: "d2",
    departmentName: "Deli",
  } as VenueServiceView["readiness"][number]);
  el.requestUpdate();
  await el.updateComplete;
  await table.updateComplete;
  const description = vi.fn(),
    opened = vi.fn();
  el.addEventListener("edit-description", description);
  el.addEventListener("open-department", opened);
  await userEvent.click(
    table.shadowRoot!.querySelector<HTMLElement>("[data-test=description-setup-d2]")!,
  );
  expect(description.mock.calls.map(([event]) => (event as CustomEvent).detail)).toEqual([
    { departmentId: "d2" },
  ]);
  expect(opened).not.toHaveBeenCalled();
});

it("draws no floor-plan link on a zone row; the Floor plans page holds them", async () => {
  const { table } = await withFloorZones([
    { id: "z1", name: "Terrace" },
    { id: "z2", name: "Bar" },
  ]);
  expect(table.shadowRoot!.querySelectorAll('[data-test^="floor-plan-zone-"]')).toHaveLength(0);
  expect(table.shadowRoot!.querySelectorAll('a[href*="/manage/floor-plan"]')).toHaveLength(0);
});

it("makes no floor-plan read, on mount or when a zone's menu opens", async () => {
  const reads: unknown[][] = [];
  const { table } = await setup((async (...args) => {
    reads.push(args);
    return { tables: [] };
  }) as DashboardRequest);
  const menu = table.shadowRoot!.querySelector('[data-row-key="zone:z1"] wt-row-actions')!;
  expect(menu, "the zone has its own row menu").not.toBeNull();
  await userEvent.click(menu.shadowRoot!.querySelector("button")!);
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(reads.filter(([path]) => String(path).includes("/floor-plan"))).toEqual([]);
  expect(reads).toEqual([]);
});

it("keeps the floor-plan link out of the zone's menu", async () => {
  const { table } = await setup();
  const menu = table.shadowRoot!.querySelector('[data-row-key="zone:z1"] wt-row-actions')!;
  await userEvent.click(menu.shadowRoot!.querySelector("button")!);
  expect(
    [...menu.querySelectorAll("wt-button")].map((button) => button.textContent!.trim()),
  ).toEqual(["Edit", "Delete"]);
  expect(menu.querySelector("a")).toBeNull();
  expect(
    table.shadowRoot!.querySelectorAll("wt-row-actions [data-test^=floor-plan-zone-]"),
  ).toHaveLength(0);
});

it("orders the columns as drawn, ignoring an older table's stored order and a stored order naming the removed Also edit column", async () => {
  localStorage.setItem(
    "waitron.venue.departments:column-order",
    JSON.stringify(["receiptPrintMode", "paidWhen", "orderStart"]),
  );
  localStorage.setItem("waitron.venue.departments:columns", JSON.stringify({ orderStart: false }));
  localStorage.setItem(
    "waitron.venue.departments-zones:column-order",
    JSON.stringify(["also", "orderStart", "paidWhen"]),
  );
  localStorage.setItem("waitron.venue.departments-zones:columns", JSON.stringify({ also: true }));
  const { table } = await setup();
  expect(
    [...table.shadowRoot!.querySelectorAll("thead th")].map((th) => th.textContent!.trim()),
  ).toEqual(["Name", "How orders start", "When counter service is used", "Actions"]);
  expect(table.shadowRoot!.querySelectorAll('[data-row-key="department:d1"] td')).toHaveLength(4);
});

it("has no Also edit column in Spanish either", async () => {
  setLocale("es");
  const { table } = await setup();
  expect(table.columns.map(({ label }) => label)).toEqual([
    "Nombre",
    "Cómo empiezan los pedidos",
    "Cuando se usa el servicio en mostrador",
    "Acciones",
  ]);
  expect(table.shadowRoot!.textContent).not.toContain("Editar también");
});
