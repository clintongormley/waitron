import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { setLocale } from "@waitron/dashboard-kit";
import {
  mount,
  mountInShadowRoot,
  cleanup,
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

      active: true,
    },
    {
      id: "d2",
      name: "Deli",
      tradingName: "Casa Delgado Deli",

      active: true,
    },
  ],
  zones: [
    {
      id: "z1",
      name: "Dining room",
      departmentId: "d1",
      departmentName: "Restaurant and bar",
      serviceMode: "table_tab",
      active: true,
    },
    {
      id: "z2",
      name: "Bar",
      departmentId: "d1",
      departmentName: "Restaurant and bar",
      serviceMode: "table_tab",
    },
    {
      id: "z3",
      name: "Old terrace",
      departmentId: "d1",
      departmentName: "Restaurant and bar",
      serviceMode: "table_tab",
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
  printMovedSlips: true,
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
  return [...table(el).shadowRoot!.querySelectorAll('tbody tr[data-row-key^="department:"]')];
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
  it("shows service columns and only active department and zone rows", async () => {
    const el = await setup();
    const list = table(el);
    expect(list.viewKey).toBe("waitron.venue.departments-zones");
    expect(list.columns.map(({ key, label }) => [key, label])).toEqual([
      ["name", "Name"],
      ["orderStart", "How orders start"],
      ["paidWhen", "When counter service is used"],
      ["receiptPrintMode", "Print a receipt"],
      ["also", "Also edit"],
      ["actions", "Actions"],
    ]);
    expect(list.columns.at(-1)).toMatchObject({ key: "actions", pinned: "end" });
    expect(
      rows(el).map((row) =>
        [...row.querySelectorAll("td")].slice(0, 4).map((cell) => cell.textContent!.trim()),
      ),
    ).toEqual([
      ["Restaurant and bar", "Counter service", "Paid before preparation", "Always"],
      ["Deli", "Counter service", "Paid before preparation", "Always"],
    ]);
    expect(list.shadowRoot!.querySelector('[part="disabled-note"]')).toBeNull();
  });
  it("puts the department and its zone problems only in that department's name cell", async () => {
    const el = await setup({
      ...model,
      readiness: [
        { code: "department.no_periods", departmentId: "d1", departmentName: "Restaurant and bar" },
        { code: "zone.menu_unpublished", zoneId: "z1", zoneName: "Dining room" },
        { code: "zone.menu_empty", zoneId: "z2", zoneName: "Bar", menuId: "m1", menuName: "Lunch" },
      ],
    });
    const cells = rows(el).map((row) => row.querySelectorAll("td")[0]!);
    expect(cells[0]!.textContent).toContain("Restaurant and bar has no opening periods.");
    expect(cells[0]!.querySelector('[part="setup-issue"] a')!.getAttribute("href")).toBe(
      "/manage/opening-hours/view/year/window/periods",
    );
    expect(cells[0]!.querySelector('[part="setup-issue"] a')!.textContent).toBe("Set up periods");
    expect(cells[0]!.textContent).toContain("Dining room needs an active, published menu.");
    expect(cells[0]!.textContent).toContain("Bar: Lunch has no products for Bar.");
    expect(cells[1]!.querySelectorAll('[part="setup-issue"]')).toHaveLength(0);
  });
  it("keeps another department's zone issues out of a ready department", async () => {
    const el = await setup({
      ...model,
      departments: model.departments.map((department) => ({ ...department, active: true })),
      readiness: [{ code: "zone.menu_unpublished", zoneId: "z1", zoneName: "Dining room" }],
    });
    expect(rows(el)[0]!.querySelectorAll("td")[0]!.textContent).toContain(
      "Dining room needs an active, published menu.",
    );
    expect(
      rows(el)[1]!.querySelectorAll("td")[0]!.querySelectorAll('[part="setup-issue"]'),
    ).toHaveLength(0);
  });
  it("warns, above the table, of each year a repeating holiday date will not apply", async () => {
    const el = await setup({
      ...model,
      readiness: [
        {
          code: "special_day.holiday_missing",
          specialDayId: "sd1",
          holidayName: "Viernes Santo",
          year: 2027,
        },
      ],
    });
    const warning = find(el, '[data-test="holiday-missing"]')!;
    expect(warning.textContent!.trim()).toBe(
      "Viernes Santo (Every year) has no public holiday of that name in 2027.",
    );
    expect(
      warning.compareDocumentPosition(table(el)) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("warns, above the table, of two special days that fall on one date, naming the one that applies", async () => {
    const clash = {
      ...model,
      readiness: [
        {
          code: "special_day.date_shared" as const,
          date: "2027-03-26",
          specialDayId: "sd2",
          specialDayName: "Feria",
          otherSpecialDayId: "sd1",
          otherSpecialDayName: "Viernes Santo",
        },
      ],
    };
    const el = await setup(clash);
    const warning = find(el, '[data-test="date-shared"]')!;
    expect(warning.textContent!.trim()).toBe(
      "Viernes Santo and Feria both fall on Fri, 26 Mar 2027. Feria applies; change one to choose.",
    );
    expect(
      warning.compareDocumentPosition(table(el)) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    cleanup();
    setLocale("es");
    const es = await setup(clash);
    expect(find(es, '[data-test="date-shared"]')!.textContent!.trim()).toBe(
      "Viernes Santo y Feria caen el vie, 26 mar 2027. Se aplica Feria; cambia uno para elegir.",
    );
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
      "No department is available: add one to take orders",
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
    ["add-zone-d1", "add-zone", { departmentId: "d1" }],
    ["receipt-department-d1", "edit-receipt", { departmentId: "d1" }],
    ["edit-zone-z1", "edit-zone", { zoneId: "z1" }],
    ["delete-zone-z1", "delete-zone", { zoneId: "z1" }],
    ["delete-department-d1", "delete-department", { departmentId: "d1" }],
    ["delete-department-d2", "delete-department", { departmentId: "d2" }],
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
  it("deleted departments have no row or Enable action", async () => {
    const el = await setup({
      ...model,
      departments: model.departments.map((d) => ({ ...d, active: d.id !== "d2" })),
    });
    const list = table(el);
    expect(list.rows.map((row) => (row as { id: string }).id)).not.toContain("d2");
    expect(list.shadowRoot!.querySelector('[data-test="enable-department-d2"]')).toBeNull();
  });
  it("localizes service columns, active zones, venue issues and menu actions in Spanish", async () => {
    setLocale("es");
    const el = await setup({
      ...model,
      readiness: [{ code: "venue.department_missing" }],
      departments: model.departments.map((row) => ({ ...row, active: true })),
    });
    expect(table(el).columns.map(({ label }) => label)).toEqual([
      "Nombre",
      "Cómo empiezan los pedidos",
      "Cuando se usa el servicio en mostrador",
      "Imprimir el recibo",
      "Editar también",
      "Acciones",
    ]);
    expect(rows(el)[1]!.textContent).toContain("Servicio en mostrador");
    expect(table(el).shadowRoot!.querySelectorAll('[data-row-key^="zone:"]')).toHaveLength(2);
    expect(find(el, '[data-test="delete-department-d2"]')!.textContent!.trim()).toBe("Eliminar");
    expect(find(el, '[data-test="no-enabled-department"]')!.textContent).toContain(
      "No hay ningún departamento disponible: añade uno para aceptar pedidos",
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
        expectRowMenusOnScreen(list, model.departments.length + 2);
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

it("retains the Spanish published-menu refusal in the owning department's name cell", async () => {
  setLocale("es");
  const el = await setup({
    ...model,
    readiness: [{ code: "zone.menu_unpublished", zoneId: "z1", zoneName: "Terraza" }],
  });
  const cells = rows(el).map((row) => row.querySelectorAll("td")[0]!);
  expect(cells[0]!.textContent).toContain("Terraza necesita una carta activa y publicada.");
  expect(cells[1]!.textContent).not.toContain("Terraza");
});

it("offers no column chooser", async () => {
  const el = await setup();
  const list = table(el);
  expect(list.shadowRoot!.querySelector(".columns-trigger")).toBeNull();
  expect(list.shadowRoot!.querySelector(".table-search")).toBeNull();
  expect(list.columns.filter((column) => column.choosable !== undefined)).toEqual([]);
});
