import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { setLocale, type DashboardRequest } from "@waitron/dashboard-kit";
import { cleanup, mount } from "@waitron/ui/src/test-helpers.js";
import { VenueServiceApi, type FloorZone } from "./client.js";
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
    "receiptPrintMode",
    "also",
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
it("styles only raw-null inheritance even when an explicit value equals its department", async () => {
  const { table } = await setup();
  const raw = table.shadowRoot!.querySelector('[data-row-key="zone:z2"]')!;
  const explicit = table.shadowRoot!.querySelector('[data-row-key="zone:z3"]')!;
  expect(raw, "zone rows are shown under their departments").not.toBeNull();
  expect(explicit, "explicit zone rows are shown").not.toBeNull();
  expect(raw.querySelector("[part~=inherited-orderStart]")!.textContent).toBe("Table service");
  expect(raw.querySelector("[part~=inherited-paidWhen]")!.textContent).toBe(
    "Paid before preparation",
  );
  expect(raw.querySelector("[part~=inherited-receiptPrintMode]")).toBeNull();
  expect(explicit.querySelector("[part~=inherited]")).toBeNull();
  const inherited = raw.querySelector("[part~=inherited]")!;
  expect(getComputedStyle(inherited).fontStyle).toBe("italic");
  expect(getComputedStyle(inherited).color).not.toBe(
    getComputedStyle(explicit.querySelector("[part~=policy]")!).color,
  );
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

it("names missing department receipt setup and opens that receipt without activating the row", async () => {
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
  const receipt = vi.fn(),
    edit = vi.fn();
  el.addEventListener("edit-receipt", receipt);
  el.addEventListener("open-department", edit);
  const action = row.querySelector<HTMLElement>("[data-test=receipt-setup-d1]");
  expect(action, "missing-description setup offers its receipt editor").not.toBeNull();
  await userEvent.click(action!);
  expect(receipt.mock.calls.map(([event]) => (event as CustomEvent).detail)).toEqual([
    { departmentId: "d1" },
  ]);
  expect(edit).not.toHaveBeenCalled();
  el.receiptAvailable = () => false;
  await el.updateComplete;
  await table.updateComplete;
  expect(row.textContent).toContain("Set up the tax-agency description");
  expect(row.querySelector("[data-test=receipt-setup-d1]")).toBeNull();
});

function alsoCell(table: Element, rowKey: string) {
  const row = table.shadowRoot!.querySelector(`[data-row-key="${rowKey}"]`);
  expect(row, `${rowKey} is shown`).not.toBeNull();
  const index = (table as HTMLElementTagNameMap["wt-data-table"]).columns.findIndex(
    ({ key }) => key === "also",
  );
  return row!.querySelectorAll("td")[index]!;
}
async function withFloorZones(floorZones: FloorZone[]) {
  const { el, table } = await setup();
  el.model = { ...el.model!, floorZones };
  await el.updateComplete;
  await table.updateComplete;
  return { el, table };
}

it("offers a department's Receipt in its Also edit cell, opening the receipt without activating the row", async () => {
  const { el, table } = await setup();
  const cell = alsoCell(table, "department:d1");
  const link = cell.querySelector<HTMLAnchorElement>('a[data-test="receipt-department-d1"]');
  expect(link, "the department row offers its receipt").not.toBeNull();
  expect(link!.textContent!.trim()).toBe("Receipt");
  expect(link!.getAttribute("href")).toBe("/manage/venue-operations/department/d1/view/receipt");
  expect(link!.hasAttribute("data-own-click")).toBe(true);
  expect(link!.closest("wt-row-actions")).toBeNull();
  const receipt = vi.fn(),
    opened = vi.fn();
  el.addEventListener("edit-receipt", receipt);
  el.addEventListener("open-department", opened);
  await userEvent.click(link!);
  expect(receipt.mock.calls.map(([event]) => (event as CustomEvent).detail)).toEqual([
    { departmentId: "d1" },
  ]);
  expect(opened).not.toHaveBeenCalled();
  expect(location.pathname).not.toContain("/view/receipt");

  const modified = new MouseEvent("click", {
    bubbles: true,
    composed: true,
    cancelable: true,
    ctrlKey: true,
  });
  let preventedBeforeHarness: boolean | undefined;
  link!.addEventListener(
    "click",
    (click) => {
      preventedBeforeHarness = click.defaultPrevented;
      click.preventDefault();
    },
    { once: true },
  );
  link!.dispatchEvent(modified);
  expect(preventedBeforeHarness).toBe(false);
  expect(receipt).toHaveBeenCalledTimes(1);

  el.receiptAvailable = (department) => department.id !== "d1";
  await el.updateComplete;
  await table.updateComplete;
  expect(alsoCell(table, "department:d1").textContent!.trim()).toBe("");
  expect(alsoCell(table, "department:d2").textContent!.trim()).toBe("Receipt");
  el.receiptAvailable = () => true;
  await el.updateComplete;
  await table.updateComplete;
  expect(alsoCell(table, "department:d1").textContent!.trim()).toBe("Receipt");
});

it("draws no floor-plan link on a zone row; the Floor plans page holds them", async () => {
  const { table } = await withFloorZones([
    { id: "z1", name: "Terrace" },
    { id: "z2", name: "Bar" },
  ]);
  expect(alsoCell(table, "zone:z1").textContent!.trim()).toBe("");
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

it("orders the columns as drawn, ignoring an order stored before the Also edit column", async () => {
  localStorage.setItem(
    "waitron.venue.departments:column-order",
    JSON.stringify(["receiptPrintMode", "paidWhen", "orderStart"]),
  );
  localStorage.setItem("waitron.venue.departments:columns", JSON.stringify({ orderStart: false }));
  const { table } = await setup();
  expect(
    [...table.shadowRoot!.querySelectorAll("thead th")].map((th) => th.textContent!.trim()),
  ).toEqual([
    "Name",
    "How orders start",
    "When counter service is used",
    "Print a receipt",
    "Also edit",
    "Actions",
  ]);
});

it("names each Also edit link's row, in English and Spanish", async () => {
  const floorZones = [
    { id: "z1", name: "Terrace" },
    { id: "z2", name: "Bar" },
  ];
  const { table } = await withFloorZones(floorZones);
  const label = (selector: string) =>
    table.shadowRoot!.querySelector(selector)!.getAttribute("aria-label");
  expect(label('[data-test="receipt-department-d1"]')).toBe("Restaurant: Receipt");
  cleanup();
  setLocale("es");
  const es = await withFloorZones(floorZones);
  expect(es.table.columns.find(({ key }) => key === "also")!.label).toBe("Editar también");
  const esLink = (selector: string) => es.table.shadowRoot!.querySelector(selector)!;
  expect(esLink('[data-test="receipt-department-d1"]').textContent!.trim()).toBe("Recibo");
});
