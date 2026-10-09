import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { setLocale } from "@waitron/dashboard-kit";
import {
  mount,
  mountInShadowRoot,
  cleanup,
  host,
  expectRowMenusOnScreen,
} from "@waitron/ui/src/test-helpers.js";
import type { WtDataTable } from "@waitron/ui/src/components/wt-data-table.js";
import type { VenueServiceView } from "./client.js";

import "./departments-list.js";

type List = HTMLElement & { model: VenueServiceView; updateComplete: Promise<unknown> };
const model: VenueServiceView = {
  departments: [
    {
      id: "d1",
      name: "Restaurant and bar",
      tradingName: "Casa Delgado",
      defaultServiceMode: "table_tab",
      active: true,
    },
    {
      id: "d2",
      name: "Deli",
      tradingName: "Casa Delgado Deli",
      defaultServiceMode: "prepay",
      active: false,
    },
  ],
  zones: [
    {
      id: "z1",
      name: "Dining room",
      departmentId: "d1",
      departmentName: "Restaurant and bar",
      serviceMode: "table_tab",
      serviceModeOverride: null,
      active: true,
    },
    {
      id: "z2",
      name: "Bar",
      departmentId: "d1",
      departmentName: "Restaurant and bar",
      serviceMode: "table_tab",
      serviceModeOverride: null,
    },
    {
      id: "z3",
      name: "Old terrace",
      departmentId: "d1",
      departmentName: "Restaurant and bar",
      serviceMode: "table_tab",
      serviceModeOverride: null,
      active: false,
    },
  ],
  floorZones: [
    { id: "z1", name: "Dining room" },
    { id: "z2", name: "Bar" },
    { id: "z3", name: "Old terrace", active: false },
    { id: "z4", name: "Patio" },
  ],
  readiness: [],
  salePolicies: { departments: [], zones: [] },
  settings: { editSentLines: true },
  kitchenTicketGrouping: "combined",
  printHeldWork: false,
  releaseReminderMinutes: 10,
  clearingWorkflow: false,
};
beforeEach(() => {
  setLocale("en");
  sessionStorage.clear();
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  setLocale("en");
  sessionStorage.clear();
  localStorage.clear();
});
async function setup(view = model, shadow = false) {
  const el = (await (shadow ? mountInShadowRoot : mount)(
    "<departments-list></departments-list>",
  )) as List;
  el.model = structuredClone(view);
  await el.updateComplete;
  await new Promise((resolve) => setTimeout(resolve, 0));
  return el;
}

it.each([
  { ctrlKey: true },
  { metaKey: true },
  { shiftKey: true },
  { altKey: true },
  { button: 1 },
])("leaves a modified department name link to the browser: %j", async (options) => {
  const el = await setup();
  const link = find(el, '[data-test="open-department-name-d1"]')!;
  const opened = vi.fn();
  el.addEventListener("open-department", opened);
  const event = new MouseEvent("click", {
    bubbles: true,
    composed: true,
    cancelable: true,
    ...options,
  });
  let preventedBeforeHarness: boolean | undefined;
  link.addEventListener(
    "click",
    (click) => {
      preventedBeforeHarness = click.defaultPrevented;
      click.preventDefault();
    },
    { once: true },
  );
  link.dispatchEvent(event);
  expect(preventedBeforeHarness).toBe(false);
  expect(opened).not.toHaveBeenCalled();
});
function table(el: List) {
  const list = el.shadowRoot?.querySelector<WtDataTable>("wt-data-table");
  expect(list, "the department table renders").toBeTruthy();
  return list!;
}
function rows(el: List) {
  return [...table(el).shadowRoot!.querySelectorAll("tbody tr")];
}
function find(el: List, selector: string) {
  return (
    el.shadowRoot?.querySelector<HTMLElement>(selector) ??
    table(el).shadowRoot!.querySelector<HTMLElement>(selector)
  );
}
async function action(el: List, key: string) {
  const button = find(el, `[data-test="${key}"]`)!;
  expect(button).not.toBeNull();
  const menu = button.closest("wt-row-actions");
  if (menu) await userEvent.click(menu.shadowRoot!.querySelector("button")!);
  await userEvent.click(button);
}

describe("department list", () => {
  it("shows the four department columns, active zones and muted disabled notes", async () => {
    const el = await setup();
    const list = table(el);
    expect(list.viewKey).toBe("waitron.venue.departments");
    expect(list.columns.map(({ key, label }) => [key, label])).toEqual([
      ["name", "Department"],
      ["trading", "Trading name"],
      ["zones", "Zones"],
      ["setup", "Setup"],
      ["actions", "Actions"],
    ]);
    expect(list.columns.at(-1)).toMatchObject({ key: "actions", pinned: "end" });
    expect(
      rows(el).map((row) =>
        [...row.querySelectorAll("td")].slice(0, 4).map((cell) => cell.textContent!.trim()),
      ),
    ).toEqual([
      ["Restaurant and bar", "Casa Delgado", "Dining room, Bar", ""],
      ["Deli Disabled", "Casa Delgado Deli", "No zones", "Disabled"],
    ]);
    const note = list.shadowRoot!.querySelector<HTMLElement>('[part="disabled-note"]')!;
    const probe = document.createElement("span");
    probe.style.color = "var(--wt-color-text-muted)";
    host.append(probe);
    expect(getComputedStyle(note).color).toBe(getComputedStyle(probe).color);
  });
  it("puts the department and its zone problems only in that department's Setup cell", async () => {
    const el = await setup({
      ...model,
      readiness: [
        { code: "department.no_periods", departmentId: "d1", departmentName: "Restaurant and bar" },
        { code: "zone.menu_unpublished", zoneId: "z1", zoneName: "Dining room" },
        { code: "zone.menu_empty", zoneId: "z2", zoneName: "Bar", menuId: "m1", menuName: "Lunch" },
      ],
    });
    const cells = rows(el).map((row) => row.querySelectorAll("td")[3]!);
    expect(cells[0]!.textContent).toContain("Restaurant and bar has no opening periods.");
    expect(cells[0]!.querySelector("a")!.getAttribute("href")).toBe(
      "/manage/opening-hours/department/d1",
    );
    expect(cells[0]!.querySelector("a")!.textContent).toBe("Set up Opening hours");
    expect(cells[0]!.textContent).toContain("Dining room needs an active, published menu.");
    expect(cells[0]!.textContent).toContain("Bar: Lunch has no products for Bar.");
    expect(cells[1]!.textContent!.trim()).toBe("Disabled");
  });
  it("keeps another department's zone issues out of a ready department", async () => {
    const el = await setup({
      ...model,
      departments: model.departments.map((department) => ({ ...department, active: true })),
      readiness: [{ code: "zone.menu_unpublished", zoneId: "z1", zoneName: "Dining room" }],
    });
    expect(rows(el)[0]!.querySelectorAll("td")[3]!.textContent).toContain(
      "Dining room needs an active, published menu.",
    );
    expect(rows(el)[1]!.querySelectorAll("td")[3]!.textContent!.trim()).toBe("");
  });
  it("shows venue issues above and unassigned zones below, with their actions", async () => {
    const el = await setup({
      ...model,
      departments: model.departments.map((row) => ({ ...row, active: false })),
      readiness: [
        { code: "venue.default_station_missing" },
        { code: "venue.department_missing" },
        { code: "zone.department_missing", zoneId: "z4", zoneName: "Patio" },
      ],
    });
    expect(find(el, '[data-test="default-station-missing"]')!.textContent).toContain(
      "No default prep station is active. Items no rule sends anywhere cannot be sent.",
    );
    expect(
      find(el, '[data-test="default-station-missing"]')!.querySelector("a")!.getAttribute("href"),
    ).toBe("/manage/prep-stations");
    expect(find(el, '[data-test="no-enabled-department"]')!.textContent).toContain(
      "No department is enabled: enable one to take orders",
    );
    expect(find(el, '[data-test="unassigned-zones"]')!.textContent).toContain(
      "Zones in no department: Patio",
    );
    expect(
      find(el, '[data-test="default-station-missing"]')!.compareDocumentPosition(table(el)) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      table(el).compareDocumentPosition(find(el, '[data-test="unassigned-zones"]')!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
  it("gives each unassigned zone its own assignment action", async () => {
    const el = await setup({
      ...model,
      floorZones: [...model.floorZones, { id: "z5", name: "Roof" }],
      readiness: [
        { code: "zone.department_missing", zoneId: "z4", zoneName: "Patio" },
        { code: "zone.department_missing", zoneId: "z5", zoneName: "Roof" },
      ],
    });
    const line = find(el, '[data-test="unassigned-zones"]')!;
    expect(line.textContent).toContain("Zones in no department: Patio");
    expect(line.textContent).toContain(", Roof");
    expect(line.querySelectorAll("wt-button")).toHaveLength(2);
    const listener = vi.fn();
    el.addEventListener("add-to-department", listener);
    await action(el, "add-zone-to-department-z4");
    await action(el, "add-zone-to-department-z5");
    expect(listener.mock.calls.map(([event]) => (event as CustomEvent).detail)).toEqual([
      { zoneId: "z4" },
      { zoneId: "z5" },
    ]);
  });
  it("uses the empty state for no departments without the no-enabled warning", async () => {
    const el = await setup({
      ...model,
      departments: [],
      readiness: [{ code: "venue.department_missing" }],
    });
    expect(table(el).shadowRoot!.textContent).toContain("No departments yet.");
    expect(find(el, '[data-test="no-enabled-department"]')).toBeNull();
    expect(find(el, '[data-test="add-department"]')!.textContent!.trim()).toBe("+ Add department");
  });
  it.each([
    ["add-department", "add-department", null],
    ["open-department-d1", "open-department", { departmentId: "d1" }],
    ["open-department-name-d2", "open-department", { departmentId: "d2" }],
    ["rename-department-d1", "rename-department", { departmentId: "d1" }],
    ["deactivate-department-d1", "disable-department", { departmentId: "d1" }],
    ["enable-department-d2", "enable-department", { departmentId: "d2" }],
    ["add-zone-to-department-z4", "add-to-department", { zoneId: "z4" }],
  ] as const)("%s emits %s through a parent shadow root", async (key, eventName, detail) => {
    const el = await setup(
      {
        ...model,
        readiness: [{ code: "zone.department_missing", zoneId: "z4", zoneName: "Patio" }],
      },
      true,
    );
    const listener = vi.fn();
    document.addEventListener(eventName, listener);
    try {
      await action(el, key);
      expect(listener).toHaveBeenCalledTimes(1);
      expect((listener.mock.calls[0]![0] as CustomEvent).detail).toEqual(detail);
    } finally {
      document.removeEventListener(eventName, listener);
    }
  });
  it("offers Enable only for disabled departments and replaces it after the parent enables one", async () => {
    const el = await setup();
    expect(find(el, '[data-test="deactivate-department-d2"]')).toBeNull();
    expect(find(el, '[data-test="enable-department-d2"]')!.textContent!.trim()).toBe("Enable");
    expect(find(el, '[data-test="enable-department-d1"]')).toBeNull();
    expect(find(el, '[data-test="deactivate-department-d1"]')!.textContent!.trim()).toBe(
      "Disable department",
    );
    const listener = vi.fn();
    el.addEventListener("enable-department", listener);
    await action(el, "enable-department-d2");
    expect(listener).toHaveBeenCalledTimes(1);
    expect((listener.mock.calls[0]![0] as CustomEvent).detail).toEqual({ departmentId: "d2" });
    el.model = {
      ...model,
      departments: model.departments.map((row) => ({ ...row, active: true })),
    };
    await el.updateComplete;
    await table(el).updateComplete;
    expect(rows(el).map((row) => row.querySelectorAll("td")[3]!.textContent!.trim())).toEqual([
      "",
      "",
    ]);
    expect(find(el, '[data-test="enable-department-d2"]')).toBeNull();
    expect(find(el, '[data-test="deactivate-department-d2"]')).not.toBeNull();
  });
  it("localizes columns, empty zones, venue issues and menu actions in Spanish", async () => {
    setLocale("es");
    const el = await setup({
      ...model,
      readiness: [{ code: "venue.department_missing" }],
      departments: model.departments.map((row) => ({ ...row, active: false })),
    });
    expect(table(el).columns.map(({ label }) => label)).toEqual([
      "Departamento",
      "Nombre comercial",
      "Zonas",
      "Configuración",
      "Acciones",
    ]);
    expect(rows(el)[1]!.textContent).toContain("Sin zonas");
    expect(find(el, '[data-test="enable-department-d2"]')!.textContent!.trim()).toBe("Habilitar");
    expect(find(el, '[data-test="no-enabled-department"]')!.textContent).toContain(
      "Ningún departamento está habilitado: habilita uno para aceptar pedidos",
    );
  });
  it.each(["en", "es"])(
    "keeps every row's menu on screen and uncovered (390 px, %s)",
    async (locale) => {
      const width = window.innerWidth,
        height = window.innerHeight;
      try {
        setLocale(locale);
        await page.viewport(390, 844);
        expect(window.innerWidth).toBe(390);
        const el = await setup({
          ...model,
          departments: [
            {
              ...model.departments[0]!,
              name: "Restaurante, terraza y barra de la planta principal",
            },
            model.departments[1]!,
          ],
        });
        const list = table(el);
        list.scrollIntoView({ block: "center" });
        expectRowMenusOnScreen(list, model.departments.length);
      } finally {
        await page.viewport(width, height);
      }
    },
  );
});

it("a disabled parent's assigned zones never become unassigned actions", async () => {
  const el = await setup({
    ...model,
    departments: model.departments.map((d) => ({ ...d, active: false })),
    floorZones: [...model.floorZones, { id: "disabled-unassigned", name: "Unused", active: false }],
    readiness: [
      { code: "zone.department_missing", zoneId: "disabled-unassigned", zoneName: "Unused" },
    ],
  });
  const line = find(el, "[data-test=unassigned-zones]")!;
  expect(line).not.toBeNull();
  expect(line.textContent).toContain("Unused");
  expect(line.textContent).not.toContain("Dining room");
  expect(line.textContent).not.toContain("Bar");
  expect(line.querySelector("[data-test=enable-zone]")).toBeNull();
  expect(line.querySelector("[data-test=disable-zone]")).toBeNull();
  expect(el.shadowRoot!.querySelectorAll("[data-test=add-department]")).toHaveLength(1);
});
it("the Spanish empty department list says why it has no rows", async () => {
  setLocale("es");
  const el = await setup({ ...model, departments: [] });
  expect(table(el).shadowRoot!.textContent).toContain("Todavía no hay departamentos.");
});

it("retains alphabetical department sorting without changing the supplied display order", async () => {
  const el = await setup();
  const names = () =>
    rows(el).map((row) =>
      row.querySelector("[data-test^=open-department-name]")!.textContent!.trim(),
    );
  expect(names()).toEqual(["Restaurant and bar", "Deli"]);
  const sort = table(el).shadowRoot!.querySelector<HTMLButtonElement>('[data-sort="name"]')!;
  expect(sort).not.toBeNull();
  sort.click();
  await table(el).updateComplete;
  expect(names()).toEqual(["Deli", "Restaurant and bar"]);
  expect(el.model.departments.map((row) => row.name)).toEqual(["Restaurant and bar", "Deli"]);
});

it("retains the Spanish published-menu refusal in the owning department's Setup cell", async () => {
  setLocale("es");
  const el = await setup({
    ...model,
    readiness: [{ code: "zone.menu_unpublished", zoneId: "z1", zoneName: "Terraza" }],
  });
  const cells = rows(el).map((row) => row.querySelectorAll("td")[3]!);
  expect(cells[0]!.textContent).toContain("Terraza necesita una carta activa y publicada.");
  expect(cells[1]!.textContent).not.toContain("Terraza");
});
