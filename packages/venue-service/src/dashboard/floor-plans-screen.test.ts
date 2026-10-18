import { afterEach, beforeEach, expect, it } from "vitest";
import { setLocale, type DashboardRequest } from "@waitron/dashboard-kit";
import type { WtDataTable } from "@waitron/ui";
import type { FloorPlanSetsModel } from "../floor-plan-set-types.js";
import { casaMarina } from "./floor-plans-fixture.js";
import { VenueServiceApi } from "./client.js";
import type { FloorPlansScreen } from "./floor-plans-screen.js";
import "./floor-plans-screen.js";

const hosts: HTMLElement[] = [];
beforeEach(() => setLocale("en"));
afterEach(() => {
  for (const host of hosts.splice(0)) host.remove();
  setLocale("en");
});

async function mountScreen(
  options: { readOnly?: boolean; model?: FloorPlanSetsModel } = {},
): Promise<{ screen: FloorPlansScreen; table: WtDataTable<unknown>; paths: string[] }> {
  const paths: string[] = [];
  const request = (async (path: string, _method: string, _body: unknown, init?: unknown) => {
    paths.push(`${path} ${JSON.stringify(init ?? {})}`);
    return options.model ?? casaMarina();
  }) as DashboardRequest;
  const screen = document.createElement("dashboard-floor-plans-screen") as FloorPlansScreen;
  screen.api = new VenueServiceApi(request);
  screen.readOnly = options.readOnly ?? false;
  document.body.append(screen);
  hosts.push(screen);
  await expect.poll(() => screen.shadowRoot!.querySelector("wt-data-table")).not.toBeNull();
  const table = screen.shadowRoot!.querySelector("wt-data-table") as WtDataTable<unknown>;
  await table.updateComplete;
  return { screen, table, paths };
}

function cell(table: WtDataTable<unknown>, rowKey: string, column: string) {
  const row = table.shadowRoot!.querySelector(`tr[data-row-key="${rowKey}"]`);
  expect(row, `${rowKey} is shown`).not.toBeNull();
  const index = table.columns.findIndex(({ key }) => key === column);
  expect(index, `column ${column}`).toBeGreaterThanOrEqual(0);
  return row!.querySelectorAll("td")[index]!;
}
const text = (element: Element) => element.textContent!.replace(/\s+/g, " ").trim();

it("lists each department's sets, the periods using each and each zone's counts", async () => {
  const { table, paths } = await mountScreen();
  expect(paths).toEqual(['/management-api/venue-service/floor-plan-sets {"passive":true}']);
  expect(
    [...table.shadowRoot!.querySelectorAll("tbody tr[data-row-key]")].map((row) =>
      row.getAttribute("data-row-key"),
    ),
  ).toEqual([
    "department:restaurant",
    "set:standard",
    "zone:standard:inside",
    "zone:standard:terrace",
    "set:dinner",
    "zone:dinner:inside",
    "zone:dinner:terrace",
    "set:private",
    "zone:private:inside",
    "zone:private:terrace",
    "department:bar",
    "set:bar-standard",
    "zone:bar-standard:bar-zone",
    "department:deli",
  ]);
  expect(text(cell(table, "department:restaurant", "name"))).toBe("Restaurant");
  expect(text(cell(table, "set:standard", "name"))).toBe("Standard Default");
  expect(text(cell(table, "set:standard", "usedBy"))).toBe("Lunch");
  expect(cell(table, "set:standard", "usedBy").querySelector("[data-colour=blue]")).not.toBeNull();
  expect(text(cell(table, "zone:standard:inside", "tables"))).toBe("12 on the plan");
  expect(text(cell(table, "zone:standard:terrace", "tables"))).toBe("10 on the plan · 6 spare");
  expect(text(cell(table, "set:dinner", "name"))).toBe("Dinner");
  expect(text(cell(table, "set:dinner", "usedBy"))).toBe("Dinner");
  expect(text(cell(table, "zone:dinner:inside", "tables"))).toBe("11 on the plan");
  expect(text(cell(table, "zone:dinner:terrace", "tables"))).toBe("8 on the plan · 8 spare");
  expect(text(cell(table, "set:private", "usedBy"))).toBe("Not used");
  expect(text(cell(table, "zone:private:inside", "tables"))).toBe("4 on the plan · 7 spare");
  expect(text(cell(table, "zone:private:terrace", "tables"))).toBe(
    "No tables on the plan · 16 spare",
  );
  expect(text(cell(table, "zone:bar-standard:bar-zone", "tables"))).toBe("No tables yet");
  expect(text(cell(table, "department:deli", "name"))).toBe("Deli No sets yet");
});

it("says a layout places no table when the zone has tables but none counts as spare", async () => {
  const model = casaMarina();
  model.departments[1]!.zones[0]!.tableCount = 2;
  const { table } = await mountScreen({ model });
  const counts = cell(table, "zone:bar-standard:bar-zone", "tables");
  expect(text(counts)).toBe("No tables on the plan");
  expect(counts.querySelector("[part~=empty]")).not.toBeNull();
  expect(cell(table, "zone:standard:inside", "tables").querySelector("[part~=empty]")).toBeNull();
});

it("links each zone row to its set's layout in the editor, and back to this page", async () => {
  const { table } = await mountScreen();
  const link = cell(table, "zone:dinner:terrace", "name").querySelector("a")!;
  expect(text(link)).toBe("Terrace");
  expect(link.getAttribute("href")).toBe(
    "/manage/floor-plan/set/dinner/zone/terrace?back=%2Fmanage%2Ffloor-plans",
  );
  expect(link.getAttribute("aria-label")).toBe("Terrace · Dinner");
  expect(cell(table, "zone:standard:inside", "name").querySelector("a")!.getAttribute("href")).toBe(
    "/manage/floor-plan/set/standard/zone/inside?back=%2Fmanage%2Ffloor-plans",
  );
});

it("gives a set row a pinned menu, and a zone or department row none", async () => {
  const { screen, table } = await mountScreen();
  expect(screen.shadowRoot!.querySelector("[data-test=add-set]")!.textContent!.trim()).toBe(
    "+ Add set",
  );
  const actions = table.columns.find(({ key }) => key === "actions")!;
  expect(actions.pinned).toBe("end");
  for (const key of ["set:standard", "set:dinner", "set:private", "set:bar-standard"])
    expect(cell(table, key, "actions").querySelector("wt-row-actions"), key).not.toBeNull();
  expect(
    cell(table, "set:dinner", "actions").querySelector("wt-row-actions")!.getAttribute("label"),
  ).toBe("Dinner: Actions");
  for (const key of ["department:restaurant", "zone:standard:inside", "zone:dinner:terrace"])
    expect(cell(table, key, "actions").querySelector("wt-row-actions"), key).toBeNull();
});

it("shows a venue.view reader the list with no Add set and no row menus", async () => {
  const { screen, table } = await mountScreen({ readOnly: true });
  expect(screen.shadowRoot!.querySelector("[data-test=add-set]")).toBeNull();
  expect(table.columns.some(({ key }) => key === "actions")).toBe(false);
  expect(table.shadowRoot!.querySelector("wt-row-actions")).toBeNull();
  expect(text(cell(table, "zone:dinner:terrace", "tables"))).toBe("8 on the plan · 8 spare");
  expect(cell(table, "zone:dinner:terrace", "name").querySelector("a")).not.toBeNull();
});

it("says so when there is no department", async () => {
  const screen = document.createElement("dashboard-floor-plans-screen") as FloorPlansScreen;
  screen.api = new VenueServiceApi((async () => ({ departments: [] })) as DashboardRequest);
  document.body.append(screen);
  hosts.push(screen);
  await expect
    .poll(() => screen.shadowRoot!.querySelector("[data-test=no-departments]")?.textContent)
    .toBe("No departments yet. Add one in Departments and zones.");
});

it("says the read failed, and clears it once a read succeeds", async () => {
  let fail = true;
  const screen = document.createElement("dashboard-floor-plans-screen") as FloorPlansScreen;
  const api = new VenueServiceApi((async () => {
    if (fail) throw new Error("offline");
    return casaMarina();
  }) as DashboardRequest);
  screen.api = api;
  document.body.append(screen);
  hosts.push(screen);
  await expect
    .poll(() => screen.shadowRoot!.querySelector("[data-test=read-error]")?.textContent)
    .toBe("Floor plans could not be loaded. It will be tried again.");
  fail = false;
  screen.remove();
  document.body.append(screen);
  await expect.poll(() => screen.shadowRoot!.querySelector("[data-test=read-error]")).toBeNull();
  await expect.poll(() => screen.shadowRoot!.querySelector("wt-data-table")).not.toBeNull();
});

it("speaks Spanish", async () => {
  setLocale("es");
  const { screen, table } = await mountScreen();
  expect(screen.shadowRoot!.querySelector("h1")!.textContent!.trim()).toBe("Planos de sala");
  expect(screen.shadowRoot!.querySelector("[data-test=add-set]")!.textContent!.trim()).toBe(
    "+ Añadir conjunto",
  );
  expect(table.columns.find(({ key }) => key === "usedBy")!.label).toBe("Usado por");
  expect(text(cell(table, "set:standard", "name"))).toBe("Standard Predeterminado");
  expect(text(cell(table, "set:private", "usedBy"))).toBe("Sin usar");
  expect(text(cell(table, "zone:standard:inside", "tables"))).toBe("12 en el plano");
  expect(text(cell(table, "zone:standard:terrace", "tables"))).toBe(
    "10 en el plano · 6 de reserva",
  );
  expect(text(cell(table, "zone:private:terrace", "tables"))).toBe(
    "Ninguna mesa en el plano · 16 de reserva",
  );
  expect(text(cell(table, "zone:bar-standard:bar-zone", "tables"))).toBe("Aún no hay mesas");
  expect(text(cell(table, "department:deli", "name"))).toBe("Deli Aún no hay conjuntos");
  expect(
    cell(table, "set:dinner", "actions").querySelector("wt-row-actions")!.getAttribute("label"),
  ).toBe("Dinner: Acciones");
});
