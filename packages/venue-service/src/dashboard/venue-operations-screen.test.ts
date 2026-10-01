import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { LiveData, setLocale } from "@waitron/dashboard-kit";
import { applyTokens, setContentLanguages } from "@waitron/ui";
import { expectRowMenusOnScreen, formMessageOf } from "@waitron/ui/src/test-helpers.js";
import type { VenueServiceApi, VenueServiceView } from "./client.js";
import type { VenueOperationsScreen } from "./venue-operations-screen.js";
import "./venue-operations-screen.js";

const hosts: HTMLElement[] = [];
const originalUrl = location.href;
const originalHistoryState: unknown = history.state;
beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  setLocale("en");
  setContentLanguages({ defaultLanguage: "en", languages: ["en"] });
});
afterEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  setLocale("en");
  setContentLanguages({ defaultLanguage: "en", languages: ["en"] });
  for (const host of hosts.splice(0)) host.remove();
  history.replaceState(originalHistoryState, "", originalUrl);
});

const model: VenueServiceView = {
  readiness: [{ code: "venue.default_station_missing" }],
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
      active: true,
    },
  ],
  zones: [
    {
      id: "z1",
      name: "Dining room",
      departmentId: "d1",
      departmentName: "Restaurant and bar",
      serviceMode: "prepay",
      serviceModeOverride: "prepay",
    },
  ],
  hours: [{ departmentId: "d2", weekday: 1, opensAt: "09:00:00", closesAt: "18:00:00" }],
  zoneMenus: [{ zoneId: "z1", menuId: "m1", displayOrder: 0, isDefault: true }],
  menus: [
    { id: "m1", name: "Casa Delgado", active: true },
    { id: "m2", name: "Deli takeaway", active: true },
  ],
  floorZones: [
    { id: "z1", name: "Dining room" },
    { id: "z2", name: "Deli counter" },
  ],
  devices: [],
  deviceZones: [],
  settings: { editSentLines: true },
  kitchenTicketGrouping: "combined",
  printHeldWork: false,
  releaseReminderMinutes: 10,
};

async function mount(api: VenueServiceApi): Promise<VenueOperationsScreen> {
  const host = document.createElement("div");
  applyTokens(host);
  document.body.appendChild(host);
  hosts.push(host);
  const el = document.createElement("dashboard-venue-operations-screen") as VenueOperationsScreen;
  el.api = api;
  host.appendChild(el);
  await el.updateComplete;
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
  return el;
}

function find(el: VenueOperationsScreen, selector: string): HTMLElement | null {
  function search(root: ParentNode): HTMLElement | null {
    const match = root.querySelector<HTMLElement>(selector);
    if (match) return match;
    for (const child of root.querySelectorAll("*")) {
      if (child.shadowRoot) {
        const found = search(child.shadowRoot);
        if (found) return found;
      }
    }
    return null;
  }
  return search(el.shadowRoot!);
}

async function settle(el: VenueOperationsScreen) {
  await el.updateComplete;
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
}

async function selectTab(el: VenueOperationsScreen, key: string) {
  const tabs = el.shadowRoot!.querySelector("wt-tabs")!;
  tabs.shadowRoot!.querySelector<HTMLButtonElement>(`[data-key="${key}"]`)!.click();
  await settle(el);
  await tabs.updateComplete;
}

async function action(el: VenueOperationsScreen, name: string) {
  const button = find(el, `[data-test="${name}"]`)!;
  expect(button, name).not.toBeNull();
  const menu = button.closest("wt-row-actions");
  if (menu) menu.shadowRoot!.querySelector<HTMLButtonElement>("button")!.click();
  button.click();
  await settle(el);
}

function field(el: VenueOperationsScreen, name: string) {
  return el.shadowRoot!.querySelector<HTMLInputElement | HTMLSelectElement>(`[name="${name}"]`)!;
}
function input(el: VenueOperationsScreen, name: string) {
  return el.shadowRoot!.querySelector<HTMLInputElement>(`[name="${name}"]`)!;
}
function table(el: VenueOperationsScreen, name: string) {
  const result = el.shadowRoot!.querySelector(`[data-test="${name}"]`)!;
  expect(result.tagName).toBe("WT-DATA-TABLE");
  return result;
}
function tableText(el: VenueOperationsScreen, name: string) {
  return table(el, name).shadowRoot!.querySelector("table")!.textContent!;
}
/** The alert at the top of the screen: a load failure, or a refusal of something saved at once. */
function pageAlert(el: VenueOperationsScreen) {
  return el.shadowRoot!.querySelector('[data-test="page-alert"]')!.textContent!.trim();
}
/** The editor's one message, at the end of the dialog's body. */
async function bottom(el: VenueOperationsScreen): Promise<string> {
  const actions = el.shadowRoot!.querySelector("wt-modal")!.querySelector("wt-form-actions")!;
  return (await formMessageOf(actions))?.textContent?.trim() ?? "";
}
function saveDisabled(el: VenueOperationsScreen) {
  return find(el, '[data-test="save-editor"]')!.hasAttribute("disabled");
}
/** Types a value the way a person does, so the editor hears the change. */
async function type(el: VenueOperationsScreen, name: string, value: string) {
  const control = field(el, name);
  control.value = value;
  control.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  control.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
  await settle(el);
}

describe("venue operations screen", () => {
  it("puts each tab's available Add actions beside the tablist", async () => {
    const el = await mount({
      load: vi.fn().mockResolvedValue(model),
    } as unknown as VenueServiceApi);
    const tabs = el.shadowRoot!.querySelector("wt-tabs")!;
    await selectTab(el, "departments");
    expect(tabs.querySelector('[slot="actions"] [data-test="new-department"]')).not.toBeNull();
    expect(find(el, '[data-test="new-department"]')!.checkVisibility()).toBe(true);
    expect(tabs.querySelector('[slot="actions"] [data-test="new-hours"]')).not.toBeNull();
    expect(tabs.querySelector('[slot="departments"] [data-test="new-department"]')).toBeNull();
    await selectTab(el, "zones");
    await action(el, "zone-menus-z1");
    expect(tabs.querySelector('[slot="actions"] [data-test="new-assignment-z1"]')).not.toBeNull();
    expect(find(el, '[data-test="new-assignment-z1"]')!.checkVisibility()).toBe(true);
    expect(tabs.querySelector('[slot="zones"] [data-test="new-assignment-z1"]')).toBeNull();
  });

  it("disables Make available when a floor zone has no service zone", async () => {
    const el = await mount({
      load: vi.fn().mockResolvedValue(model),
    } as unknown as VenueServiceApi);
    await selectTab(el, "zones");
    await action(el, "zone-menus-z2");
    const button = find(el, '[data-test="new-assignment-z2"]')!;
    expect(button).not.toBeNull();
    expect(button.hasAttribute("disabled")).toBe(true);
  });

  it("lists active tills, excludes kitchen screens, and saves and clears a starting zone", async () => {
    const view: VenueServiceView = {
      ...model,
      devices: [
        { id: "t1", label: "Front till", kind: "till", active: true },
        { id: "k1", label: "Kitchen screen", kind: "kds_station", active: true },
        { id: "t2", label: "Old till", kind: "till", active: false },
      ],
      deviceZones: [],
    };
    const api = {
      load: vi.fn().mockResolvedValue(view),
      setDeviceDefaultZone: vi.fn().mockResolvedValue(undefined),
      clearDeviceDefaultZone: vi.fn().mockResolvedValue(undefined),
    } as unknown as VenueServiceApi;
    const el = await mount(api);
    await selectTab(el, "zones");
    expect(tableText(el, "tills")).toContain("Front till");
    expect(tableText(el, "tills")).not.toContain("Kitchen screen");
    expect(tableText(el, "tills")).not.toContain("Old till");
    const selector = table(el, "tills").shadowRoot!.querySelector<HTMLSelectElement>(
      'select[aria-label="Front till: Starts in"]',
    )!;
    expect(selector).not.toBeNull();
    expect(selector.options[0]!.textContent).toBe("The venue's counter zone");
    selector.value = "z1";
    selector.dispatchEvent(new Event("change", { bubbles: true }));
    await settle(el);
    expect(api.setDeviceDefaultZone).toHaveBeenCalledWith("t1", "z1");
    selector.value = "";
    selector.dispatchEvent(new Event("change", { bubbles: true }));
    await settle(el);
    expect(api.clearDeviceDefaultZone).toHaveBeenCalledWith("t1");
  });
  it("shows a load error when the venue configuration request fails", async () => {
    const api = {
      load: vi.fn().mockRejectedValue(new Error("offline")),
    } as unknown as VenueServiceApi;
    const el = await mount(api);
    expect(pageAlert(el)).toContain("could not be loaded");
  });

  it("shows a message under every missing required department field, and one above Save", async () => {
    const api = {
      load: vi.fn().mockResolvedValue(model),
      createDepartment: vi.fn(),
    } as unknown as VenueServiceApi;
    const el = await mount(api);
    await selectTab(el, "departments");
    await action(el, "new-department");
    await action(el, "save-editor");
    expect(await bottom(el)).toBe("Correct the highlighted fields to continue.");
    expect(pageAlert(el)).toBe("");
    expect(el.shadowRoot!.querySelector("wt-form-error-summary")).toBeNull();
    expect(fieldError(el, "department-name")).toBe("This field is required.");
    expect(fieldError(el, "trading-name")).toBe("This field is required.");
    expect(api.createDepartment).not.toHaveBeenCalled();
  });

  it("holds the department editor's fields and their errors to the standard form width on a wide window", async () => {
    const width = window.innerWidth,
      height = window.innerHeight;
    await page.viewport(1280, 800);
    try {
      const el = await mount({
        load: vi.fn().mockResolvedValue(model),
      } as unknown as VenueServiceApi);
      await selectTab(el, "departments");
      await action(el, "new-department");
      await action(el, "save-editor");
      const probe = document.createElement("div");
      probe.style.width = "var(--wt-form-max-width)";
      el.shadowRoot!.appendChild(probe);
      const form = probe.getBoundingClientRect().width;
      expect(modal(el)!.shadowRoot!.querySelector(".body")!.clientWidth).toBeGreaterThan(form);
      const parts = modal(el)!.querySelectorAll(
        ".form label, .form input, .form select, .field-error",
      );
      expect(parts).toHaveLength(8);
      for (const part of parts) {
        expect(part.getBoundingClientRect().width, part.outerHTML).toBeCloseTo(form, 0);
      }
    } finally {
      await page.viewport(width, height);
    }
  });

  it("uses localized weekday names", async () => {
    setLocale("es");
    const el = await mount({
      load: vi.fn().mockResolvedValue(model),
    } as unknown as VenueServiceApi);
    await selectTab(el, "departments");
    expect(tableText(el, "hours")).toContain("Lunes");
    expect(tableText(el, "hours")).toContain("09:00");
    expect(tableText(el, "hours")).toContain("18:00");
    await action(el, "new-hours");
    expect(field(el, "hours-weekday").textContent).toContain("Domingo");
  });

  it("shows departments, trading names, zones, menu defaults and hours", async () => {
    const el = await mount({
      load: vi.fn().mockResolvedValue(model),
    } as unknown as VenueServiceApi);
    expect(el.shadowRoot!.querySelector('[data-test="readiness-issue-0"]')!.textContent).toContain(
      "No default prep station is switched on.",
    );
    await selectTab(el, "departments");
    expect(tableText(el, "departments")).toContain("Restaurant and bar");
    expect(tableText(el, "departments")).toContain("Casa Delgado Deli");
    expect(tableText(el, "hours")).toContain("Monday");
    expect(tableText(el, "hours")).toContain("09:00");
    expect(tableText(el, "hours")).toContain("18:00");
    await selectTab(el, "zones");
    expect(tableText(el, "zones")).toContain("Dining room");
    expect(tableText(el, "zones")).toContain("Deli counter");
    expect(tableText(el, "zones")).toContain("Casa Delgado");
    await action(el, "edit-zone-z1");
    expect(field(el, "zone-mode-z1").value).toBe("prepay");
  });

  it("deactivates a department that has no active zones", async () => {
    const api = {
      load: vi.fn().mockResolvedValue(model),
      deactivateDepartment: vi.fn().mockResolvedValue(undefined),
    } as unknown as VenueServiceApi;
    const el = await mount(api);
    await selectTab(el, "departments");
    await action(el, "deactivate-department-d2");
    expect(api.deactivateDepartment).not.toHaveBeenCalled();
    await action(el, "save-editor");
    expect(api.deactivateDepartment).toHaveBeenCalledWith("d2");
  });

  it("shows a save error and prevents a second save while the first is pending", async () => {
    let rejectSave!: (error: Error) => void;
    const pending = new Promise<void>((_resolve, reject) => {
      rejectSave = reject;
    });
    const api = {
      load: vi.fn().mockResolvedValue(model),
      deactivateDepartment: vi.fn().mockReturnValue(pending),
    } as unknown as VenueServiceApi;
    const el = await mount(api);
    await selectTab(el, "departments");
    await action(el, "deactivate-department-d2");
    const button = find(el, '[data-test="save-editor"]')!;
    button.click();
    button.click();
    expect(api.deactivateDepartment).toHaveBeenCalledTimes(1);
    await el.updateComplete;
    expect(button.hasAttribute("disabled")).toBe(true);
    rejectSave(new Error("write failed"));
    await settle(el);
    expect(await bottom(el)).toContain("could not be saved");
    expect(pageAlert(el)).toBe("");
    expect(el.shadowRoot!.querySelector("wt-modal")).not.toBeNull();
  });

  it("creates a second department from the required management fields", async () => {
    const api = {
      load: vi.fn().mockResolvedValue(model),
      createDepartment: vi.fn().mockResolvedValue({ id: "d3" }),
    } as unknown as VenueServiceApi;
    const el = await mount(api);
    await selectTab(el, "departments");
    await action(el, "new-department");
    field(el, "department-name").value = "Events";
    field(el, "trading-name").value = "Casa Delgado Events";
    field(el, "department-mode").value = "invoice_first";
    await action(el, "save-editor");
    expect(api.createDepartment).toHaveBeenCalledWith({
      name: "Events",
      tradingName: "Casa Delgado Events",
      defaultServiceMode: "invoice_first",
    });
  });

  // A real click lets the screen re-render between its own click handler and the menu's: the
  // save it starts disables every action, which the menu must not read as a disabled click.
  it("closes the row menu when a zones action saves straight away", async () => {
    const api = {
      load: vi.fn().mockResolvedValue({
        ...model,
        zoneMenus: [
          ...model.zoneMenus,
          { zoneId: "z1", menuId: "m2", displayOrder: 1, isDefault: false },
        ],
      }),
      // Still in flight, as a real request is while the menu decides whether to close.
      allowMenu: vi.fn(() => new Promise(() => {})),
    } as unknown as VenueServiceApi;
    const el = await mount(api);
    await selectTab(el, "zones");
    await action(el, "zone-menus-z1");
    const button = find(el, '[data-test="default-assignment-m2"]')!;
    const menu = button.closest("wt-row-actions")!;
    const popup = menu.shadowRoot!.querySelector<HTMLElement>("[popover]")!;
    await userEvent.click(menu.shadowRoot!.querySelector("button")!);
    expect(popup.matches(":popover-open")).toBe(true);
    await userEvent.click(button);
    await settle(el);
    expect(vi.mocked(api.allowMenu).mock.calls.length).toBe(1);
    expect(popup.matches(":popover-open")).toBe(false);
  });

  it("renders every readiness issue", async () => {
    const variedModel: VenueServiceView = {
      ...model,
      readiness: [
        { code: "venue.default_station_missing" },
        { code: "venue.department_missing" },
        { code: "zone.department_missing", zoneId: "z1", zoneName: "Dining room" },
        { code: "zone.menu_missing", zoneId: "z2", zoneName: "Deli counter" },
        { code: "zone.menu_unpublished", zoneId: "z3", zoneName: "Terrace" },
        {
          code: "zone.menu_empty",
          zoneId: "z1",
          zoneName: "Dining room",
          menuId: "m1",
          menuName: "Casa Delgado",
        },
      ],
    };
    const el = await mount({
      load: vi.fn().mockResolvedValue(variedModel),
    } as unknown as VenueServiceApi);
    const text = el.shadowRoot!.querySelector('[data-test="readiness"]')!.textContent!;
    expect(text).toContain("No default prep station is switched on.");
    expect(text).toContain("Create an active department");
    expect(text).toContain("Dining room needs an active department");
    expect(text).toContain("Deli counter needs a default menu");
    expect(text).toContain("Terrace needs an active, published menu");
    expect(text).toContain("Casa Delgado has no products for Dining room");
  });

  it("asks in Spanish for an active, published menu for a zone with none", async () => {
    setLocale("es");
    const el = await mount({
      load: vi.fn().mockResolvedValue({
        ...model,
        readiness: [{ code: "zone.menu_unpublished", zoneId: "z3", zoneName: "Terraza" }],
      }),
    } as unknown as VenueServiceApi);
    const text = el.shadowRoot!.querySelector('[data-test="readiness"]')!.textContent!;
    expect(text).toContain("Terraza necesita una carta activa y publicada.");
  });
});
it("shows four tabs, read-only tables, and creates departments in a cancellable modal", async () => {
  const api = {
    load: vi.fn().mockResolvedValue(model),
    createDepartment: vi.fn(),
  } as unknown as VenueServiceApi;
  const el = await mount(api);
  expect(
    el.shadowRoot!.querySelector("wt-tabs")!.shadowRoot!.querySelectorAll('[role="tab"]'),
  ).toHaveLength(4);
  expect(
    el.shadowRoot!.querySelector('[data-test="readiness"]')!.getBoundingClientRect().height,
  ).toBeGreaterThan(0);
  await selectTab(el, "departments");
  const table = el.shadowRoot!.querySelector('[data-test="departments"]')!;
  expect(table.tagName).toBe("WT-DATA-TABLE");
  expect(table.shadowRoot!.querySelector("tbody input")).toBeNull();
  expect(el.shadowRoot!.querySelector("wt-modal")).toBeNull();
  await action(el, "new-department");
  expect(el.shadowRoot!.querySelector("wt-modal")!.shadowRoot!.querySelector("dialog")!.open).toBe(
    true,
  );
  (el.shadowRoot!.querySelector('[name="department-name"]') as HTMLInputElement).value = "Draft";
  await action(el, "cancel-editor");
  expect(el.shadowRoot!.querySelector("wt-modal")).toBeNull();
  expect(api.createDepartment).not.toHaveBeenCalled();
});

it("offers no Menus tab: a menu's contents and prices are edited on the Menus screen", async () => {
  const el = await mount({ load: vi.fn().mockResolvedValue(model) } as unknown as VenueServiceApi);
  const strip = el.shadowRoot!.querySelector("wt-tabs")!;
  const tabs = [...strip.shadowRoot!.querySelectorAll('[role="tab"]')];
  expect(tabs.map((tab) => tab.getAttribute("data-key"))).toEqual([
    "status",
    "departments",
    "zones",
    "kitchen",
  ]);
  expect(tabs.map((tab) => tab.textContent!.trim())).not.toContain("Menus");
  expect(el.shadowRoot!.querySelector('[slot="menus"]')).toBeNull();
});

it("edits a department and retains its draft when saving fails", async () => {
  const api = {
    load: vi.fn().mockResolvedValue(model),
    updateDepartment: vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(undefined),
  } as unknown as VenueServiceApi;
  const el = await mount(api);
  await selectTab(el, "departments");
  await action(el, "edit-department-d2");
  expect(field(el, "department-name").value).toBe("Deli");
  expect(field(el, "trading-name").value).toBe("Casa Delgado Deli");
  expect(field(el, "department-mode").value).toBe("prepay");
  field(el, "department-name").value = "Takeaway";
  field(el, "trading-name").value = "Casa Delgado To Go";
  field(el, "department-mode").value = "ticket_then_pay";
  await action(el, "save-editor");
  expect(await bottom(el)).toContain("could not be saved");
  expect(pageAlert(el)).toBe("");
  expect(field(el, "department-name").value).toBe("Takeaway");
  expect(field(el, "trading-name").value).toBe("Casa Delgado To Go");
  expect(field(el, "department-mode").value).toBe("ticket_then_pay");
  await action(el, "save-editor");
  expect(api.updateDepartment).toHaveBeenLastCalledWith("d2", {
    name: "Takeaway",
    tradingName: "Casa Delgado To Go",
    defaultServiceMode: "ticket_then_pay",
  });
  expect(el.shadowRoot!.querySelector("wt-modal")).toBeNull();
});

it("creates, edits and deletes hours while preserving other intervals in the department", async () => {
  const hoursModel: VenueServiceView = {
    ...model,
    hours: [
      ...model.hours,
      { departmentId: "d2", weekday: 2, opensAt: "10:00:00", closesAt: "19:00:00" },
      { departmentId: "d1", weekday: 1, opensAt: "12:00:00", closesAt: "23:00:00" },
    ],
  };
  const api = {
    load: vi.fn().mockResolvedValue(hoursModel),
    replaceHours: vi.fn().mockResolvedValue(undefined),
  } as unknown as VenueServiceApi;
  const el = await mount(api);
  await selectTab(el, "departments");
  await action(el, "new-hours");
  field(el, "hours-department").value = "d2";
  field(el, "hours-weekday").value = "3";
  field(el, "hours-opens").value = "11:00";
  field(el, "hours-closes").value = "20:00";
  await action(el, "save-editor");
  expect(api.replaceHours).toHaveBeenLastCalledWith("d2", [
    { weekday: 1, opensAt: "09:00", closesAt: "18:00" },
    { weekday: 2, opensAt: "10:00", closesAt: "19:00" },
    { weekday: 3, opensAt: "11:00", closesAt: "20:00" },
  ]);
  await action(el, "edit-hours-0");
  expect(field(el, "hours-department").value).toBe("d2");
  expect(field(el, "hours-department").disabled).toBe(true);
  expect(field(el, "hours-weekday").value).toBe("1");
  expect(field(el, "hours-opens").value).toBe("09:00");
  expect(field(el, "hours-closes").value).toBe("18:00");
  field(el, "hours-opens").value = "08:30";
  await action(el, "save-editor");
  expect(api.replaceHours).toHaveBeenLastCalledWith("d2", [
    { weekday: 2, opensAt: "10:00", closesAt: "19:00" },
    { weekday: 1, opensAt: "08:30", closesAt: "18:00" },
  ]);
  await action(el, "delete-hours-0");
  await action(el, "save-editor");
  expect(api.replaceHours).toHaveBeenLastCalledWith("d2", [
    { weekday: 2, opensAt: "10:00", closesAt: "19:00" },
  ]);
});

it("edits a zone policy and can return it to the department's service mode", async () => {
  const api = {
    load: vi.fn().mockResolvedValue(model),
    configureZone: vi.fn().mockResolvedValue(undefined),
  } as unknown as VenueServiceApi;
  const el = await mount(api);
  await selectTab(el, "zones");
  await action(el, "edit-zone-z1");
  expect(field(el, "zone-department-z1").value).toBe("d1");
  expect(field(el, "zone-mode-z1").value).toBe("prepay");
  field(el, "zone-department-z1").value = "d2";
  field(el, "zone-mode-z1").value = "";
  await action(el, "save-editor");
  expect(api.configureZone).toHaveBeenCalledWith("z1", { departmentId: "d2", serviceMode: null });
  await action(el, "edit-zone-z2");
  field(el, "zone-department-z2").value = "d1";
  field(el, "zone-mode-z2").value = "invoice_first";
  await action(el, "save-editor");
  expect(api.configureZone).toHaveBeenLastCalledWith("z2", {
    departmentId: "d1",
    serviceMode: "invoice_first",
  });
});

it("creates and edits zone menu assignments and preserves a current default", async () => {
  const api = {
    load: vi.fn().mockResolvedValue(model),
    allowMenu: vi.fn().mockResolvedValue(undefined),
  } as unknown as VenueServiceApi;
  const el = await mount(api);
  await selectTab(el, "zones");
  await action(el, "zone-menus-z1");
  expect(tableText(el, "zone-menus")).toContain("Casa Delgado");
  await action(el, "new-assignment-z1");
  expect(field(el, "assignment-menu").value).toBe("m2");
  expect(field(el, "assignment-menu").textContent).not.toContain("Casa Delgado");
  field(el, "assignment-order").value = "2";
  (field(el, "assignment-default") as HTMLInputElement).checked = true;
  await action(el, "save-editor");
  expect(api.allowMenu).toHaveBeenCalledWith("z1", "m2", { displayOrder: 2, makeDefault: true });
  await action(el, "edit-assignment-m1");
  expect(field(el, "assignment-menu").value).toBe("m1");
  expect(field(el, "assignment-menu").disabled).toBe(true);
  expect((field(el, "assignment-default") as HTMLInputElement).checked).toBe(true);
  expect(field(el, "assignment-default").disabled).toBe(true);
  field(el, "assignment-order").value = "3";
  await action(el, "save-editor");
  expect(api.allowMenu).toHaveBeenLastCalledWith("z1", "m1", {
    displayOrder: 3,
    makeDefault: true,
  });
});

it("closes a successfully saved editor when refreshing the list fails", async () => {
  const api = {
    load: vi.fn().mockResolvedValueOnce(model).mockRejectedValue(new Error("offline")),
    createDepartment: vi.fn().mockResolvedValue({ id: "d3" }),
  } as unknown as VenueServiceApi;
  const el = await mount(api);
  await selectTab(el, "departments");
  await action(el, "new-department");
  field(el, "department-name").value = "Events";
  field(el, "trading-name").value = "Casa Events";
  await action(el, "save-editor");
  expect(api.createDepartment).toHaveBeenCalledTimes(1);
  expect(el.shadowRoot!.querySelector("wt-modal")).toBeNull();
  expect(pageAlert(el)).toContain("could not be loaded");
});

it("ignores change events from controls inside a tab panel", async () => {
  const el = await mount({ load: vi.fn().mockResolvedValue(model) } as unknown as VenueServiceApi);
  await selectTab(el, "zones");
  const url = location.href;
  const input = document.createElement("wt-input");
  input.name = "panel-filter";
  input.label = "Filter zones";
  el.shadowRoot!.querySelector('[slot="zones"]')!.append(input);
  await input.updateComplete;
  const native = input.shadowRoot!.querySelector("input")!;
  native.value = "search text";
  native.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  await settle(el);
  expect(location.href).toBe(url);
  expect(el.shadowRoot!.querySelector("wt-tabs")!.value).toBe("zones");
});

it("explains why a department with active zones cannot be deactivated", async () => {
  const api = {
    load: vi.fn().mockResolvedValue(model),
    deactivateDepartment: vi.fn().mockRejectedValue({ code: "department.has_active_zones" }),
  } as unknown as VenueServiceApi;
  const el = await mount(api);
  await selectTab(el, "departments");
  await action(el, "deactivate-department-d1");
  await action(el, "save-editor");
  expect(await bottom(el)).toContain("Move its active service zones");
  expect(pageAlert(el)).toBe("");
  expect(el.shadowRoot!.querySelector("wt-modal")).not.toBeNull();
});

it("updates venue rows from external changes without replacing a modal draft", async () => {
  const liveData = new LiveData();
  const load = vi.fn().mockResolvedValue(structuredClone(model));
  const el = await mount({ load, liveData } as unknown as VenueServiceApi);
  await selectTab(el, "departments");
  await action(el, "edit-department-d2");
  field(el, "department-name").value = "Unsaved";
  const updated = structuredClone(model);
  updated.departments[0]!.name = "Updated elsewhere";
  load.mockResolvedValue(updated);
  liveData.invalidate([{ type: "departments", id: "d1" }]);
  await vi.waitFor(() => expect(tableText(el, "departments")).toContain("Updated elsewhere"));
  expect(field(el, "department-name").value).toBe("Unsaved");
});

function column(el: VenueOperationsScreen, name: string, index: number): string[] {
  return [...table(el, name).shadowRoot!.querySelectorAll("tbody tr")].map((row) =>
    row.querySelectorAll("td")[index]!.textContent!.trim(),
  );
}
async function sortBy(el: VenueOperationsScreen, name: string, key: string) {
  const list = table(el, name) as HTMLElement & { updateComplete: Promise<unknown> };
  list.shadowRoot!.querySelector<HTMLButtonElement>(`[data-sort="${key}"]`)!.click();
  await list.updateComplete;
}
function fieldError(el: VenueOperationsScreen, name: string) {
  return el.shadowRoot!.querySelector(`[data-field-error="${name}"]`)?.textContent?.trim();
}
function modal(el: VenueOperationsScreen) {
  return el.shadowRoot!.querySelector("wt-modal");
}

describe("the venue lists", () => {
  // Every sort below starts from an order other than its result, so a column that stopped sorting
  // would leave the rows where they were. Department and zone ids sort against their names, so a
  // column sorting by id fails too.
  it("sorts every name column alphabetically", async () => {
    const el = await mount({
      load: vi.fn().mockResolvedValue(model),
    } as unknown as VenueServiceApi);
    await selectTab(el, "departments");
    expect(column(el, "departments", 0)).toEqual(["Restaurant and bar", "Deli"]);
    await sortBy(el, "departments", "name");
    expect(column(el, "departments", 0)).toEqual(["Deli", "Restaurant and bar"]);

    await selectTab(el, "zones");
    expect(column(el, "zones", 0)).toEqual(["Dining room", "Deli counter"]);
    await sortBy(el, "zones", "name");
    expect(column(el, "zones", 0)).toEqual(["Deli counter", "Dining room"]);
  });

  it("marks inactive departments, and names a zone's non-default menus", async () => {
    const el = await mount({
      load: vi.fn().mockResolvedValue({
        ...model,
        departments: [model.departments[0]!, { ...model.departments[1]!, active: false }],
        menus: [model.menus[0]!, { ...model.menus[1]!, active: false }],
        zoneMenus: [
          ...model.zoneMenus,
          { zoneId: "z1", menuId: "m2", displayOrder: 1, isDefault: false },
        ],
      }),
    } as unknown as VenueServiceApi);
    await selectTab(el, "departments");
    expect(column(el, "departments", 3)).toEqual(["Active", "Inactive"]);
    await selectTab(el, "zones");
    await action(el, "zone-menus-z1");
    expect(column(el, "zone-menus", 1)).toEqual(["Yes", "No"]);
  });

  it("labels a zone-menu row's actions with its stored id when it is not loaded", async () => {
    const el = await mount({
      load: vi.fn().mockResolvedValue({
        ...model,
        zoneMenus: [
          ...model.zoneMenus,
          { zoneId: "z1", menuId: "m-gone", displayOrder: 1, isDefault: false },
        ],
      }),
    } as unknown as VenueServiceApi);
    await selectTab(el, "zones");
    await action(el, "zone-menus-z1");
    expect(
      [...table(el, "zone-menus").shadowRoot!.querySelectorAll("wt-row-actions")].map((menu) =>
        menu.getAttribute("label"),
      ),
    ).toEqual(["Actions: Casa Delgado", "Actions: m-gone"]);
  });

  it("makes another of a zone's menus its default straight from the list", async () => {
    const api = {
      load: vi.fn().mockResolvedValue({
        ...model,
        zoneMenus: [
          ...model.zoneMenus,
          { zoneId: "z1", menuId: "m2", displayOrder: 4, isDefault: false },
        ],
      }),
      allowMenu: vi.fn().mockResolvedValue(undefined),
    } as unknown as VenueServiceApi;
    const el = await mount(api);
    await selectTab(el, "zones");
    await action(el, "zone-menus-z1");
    expect(find(el, '[data-test="default-assignment-m1"]')!.hasAttribute("disabled")).toBe(true);
    await action(el, "default-assignment-m2");
    expect(api.allowMenu).toHaveBeenCalledWith("z1", "m2", { displayOrder: 4, makeDefault: true });
    expect(modal(el)).toBeNull();
    expect(api.load).toHaveBeenCalledTimes(2);
  });
});

describe("the venue lists' column choosers", () => {
  const chooser = (el: VenueOperationsScreen, name: string) =>
    table(el, name).shadowRoot!.querySelector(".columns-trigger")!.textContent!.trim();
  const choices = (el: VenueOperationsScreen, name: string) =>
    [...table(el, name).shadowRoot!.querySelectorAll<HTMLInputElement>("input[data-column]")].map(
      (box) => [box.dataset.column, box.checked],
    );
  const headers = (el: VenueOperationsScreen, name: string) =>
    [...table(el, name).shadowRoot!.querySelectorAll("thead th")].map((th) =>
      th.textContent!.trim(),
    );

  it.each([
    ["departments", "departments", "waitron.venue.departments.table", ["trading", "mode", "state"]],
    ["departments", "hours", "waitron.venue.hours.table", ["day", "opens", "closes"]],
    ["zones", "zones", "waitron.venue.zones.table", ["department", "mode", "default"]],
    ["zones", "zone-menus", "waitron.venue.zone-menus.table", ["default", "order"]],
  ] as const)(
    "the %s tab's %s list offers every column but the first and the actions, and remembers a hidden one",
    async (tab, name, viewKey, keys) => {
      const el = await mount({
        load: vi.fn().mockResolvedValue(model),
      } as unknown as VenueServiceApi);
      await selectTab(el, tab);
      if (name === "zone-menus") await action(el, "zone-menus-z1");
      expect(chooser(el, name)).toBe("Columns");
      expect(choices(el, name)).toEqual(keys.map((key) => [key, true]));
      const before = headers(el, name);
      expect(before).toHaveLength(keys.length + 2);
      expect(before.at(-1)).toBe("Actions");
      const list = table(el, name) as Element & { updateComplete: Promise<unknown> };
      const box = list.shadowRoot!.querySelector<HTMLInputElement>(
        `input[data-column="${keys[0]}"]`,
      )!;
      box.checked = false;
      box.dispatchEvent(new Event("change"));
      await list.updateComplete;
      expect(headers(el, name)).toEqual([before[0], ...before.slice(2)]);
      expect(JSON.parse(localStorage.getItem(`${viewKey}:columns`)!)).toEqual({ [keys[0]]: false });
    },
  );

  it("names every chooser in Spanish when the dashboard speaks it", async () => {
    setLocale("es");
    const el = await mount({
      load: vi.fn().mockResolvedValue(model),
    } as unknown as VenueServiceApi);
    await selectTab(el, "departments");
    expect(chooser(el, "departments")).toBe("Columnas");
    expect(chooser(el, "hours")).toBe("Columnas");
    await selectTab(el, "zones");
    await action(el, "zone-menus-z1");
    expect(chooser(el, "zones")).toBe("Columnas");
    expect(chooser(el, "zone-menus")).toBe("Columnas");
  });
});

describe("the venue editors refuse an incomplete form", () => {
  it("requires opening and closing times, and refuses them equal", async () => {
    const api = {
      load: vi.fn().mockResolvedValue(model),
      replaceHours: vi.fn(),
    } as unknown as VenueServiceApi;
    const el = await mount(api);
    await selectTab(el, "departments");
    await action(el, "new-hours");
    await action(el, "save-editor");
    expect(fieldError(el, "hours-opens")).toBe("This field is required.");
    expect(fieldError(el, "hours-closes")).toBe("This field is required.");
    expect(await bottom(el)).toBe("Correct the highlighted fields to continue.");
    field(el, "hours-opens").value = "10:00";
    field(el, "hours-closes").value = "10:00";
    await action(el, "save-editor");
    expect(fieldError(el, "hours-opens")).toBe("Opening and closing times must differ.");
    expect(fieldError(el, "hours-closes")).toBe("Opening and closing times must differ.");
    expect(await bottom(el)).toBe("Correct the highlighted fields to continue.");
    expect(api.replaceHours).not.toHaveBeenCalled();
  });

  it("requires a department for a zone when none is active", async () => {
    const api = {
      load: vi.fn().mockResolvedValue({
        ...model,
        departments: model.departments.map((department) => ({ ...department, active: false })),
      }),
      configureZone: vi.fn(),
    } as unknown as VenueServiceApi;
    const el = await mount(api);
    await selectTab(el, "zones");
    await action(el, "edit-zone-z2");
    await action(el, "save-editor");
    expect(fieldError(el, "zone-department-z2")).toBe("This field is required.");
    expect(await bottom(el)).toBe("Correct the highlighted fields to continue.");
    expect(api.configureZone).not.toHaveBeenCalled();
  });

  it("requires a menu for a zone that already has every active one", async () => {
    const api = {
      load: vi.fn().mockResolvedValue({
        ...model,
        zoneMenus: [
          ...model.zoneMenus,
          { zoneId: "z1", menuId: "m2", displayOrder: 1, isDefault: false },
        ],
      }),
      allowMenu: vi.fn(),
    } as unknown as VenueServiceApi;
    const el = await mount(api);
    await selectTab(el, "zones");
    await action(el, "zone-menus-z1");
    await action(el, "new-assignment-z1");
    expect(field(el, "assignment-menu").value).toBe("");
    await action(el, "save-editor");
    expect(fieldError(el, "assignment-menu")).toBe("This field is required.");
    expect(await bottom(el)).toBe("Correct the highlighted fields to continue.");
    expect(api.allowMenu).not.toHaveBeenCalled();
  });

  it("refuses a display order that is not a whole number of zero or more", async () => {
    const api = {
      load: vi.fn().mockResolvedValue(model),
      allowMenu: vi.fn().mockResolvedValue(undefined),
    } as unknown as VenueServiceApi;
    const el = await mount(api);
    await selectTab(el, "zones");
    await action(el, "zone-menus-z1");
    await action(el, "new-assignment-z1");
    for (const order of ["-1", "1.5"]) {
      field(el, "assignment-order").value = order;
      await action(el, "save-editor");
      expect(fieldError(el, "assignment-order")).toBe("Enter a whole number of zero or more.");
      expect(await bottom(el)).toBe("Correct the highlighted fields to continue.");
    }
    expect(api.allowMenu).not.toHaveBeenCalled();
    field(el, "assignment-order").value = "0";
    await action(el, "save-editor");
    expect(api.allowMenu).toHaveBeenCalledWith("z1", "m2", { displayOrder: 0, makeDefault: false });
  });
});

describe("an editor's messages", () => {
  const FIX = "Correct the highlighted fields to continue.";
  function invalid(el: VenueOperationsScreen, name: string) {
    return field(el, name).getAttribute("aria-invalid");
  }
  async function newDepartment(api: Partial<VenueServiceApi> = {}) {
    const el = await mount({
      load: vi.fn().mockResolvedValue(model),
      createDepartment: vi.fn(),
      ...api,
    } as unknown as VenueServiceApi);
    await selectTab(el, "departments");
    await action(el, "new-department");
    return el;
  }

  // Fails if the editor judges a field before Save is first pressed.
  it("says nothing before the first press, however the fields change", async () => {
    const el = await newDepartment();
    await type(el, "department-name", "Brunch");
    await type(el, "department-name", "");
    expect(fieldError(el, "department-name")).toBeUndefined();
    expect(invalid(el, "department-name")).toBe("false");
    expect(await bottom(el)).toBe("");
    expect(saveDisabled(el)).toBe(false);
  });

  // Fails if a failed press stops marking a field, saying so above Save, moving focus or holding
  // Save.
  it("marks the fields, says so above Save, focuses the first and holds Save after a failed press", async () => {
    const el = await newDepartment();
    await action(el, "save-editor");
    expect(invalid(el, "department-name")).toBe("true");
    expect(invalid(el, "trading-name")).toBe("true");
    expect(fieldError(el, "department-name")).toBe("This field is required.");
    expect(await bottom(el)).toBe(FIX);
    expect(saveDisabled(el)).toBe(true);
    await vi.waitFor(() => expect(el.shadowRoot!.activeElement).toBe(field(el, "department-name")));
  });

  // Fails if the editor stops re-checking itself on every change once Save has been pressed.
  it("re-checks every change: a fixed field loses its message and the last fix frees Save", async () => {
    const el = await newDepartment();
    await action(el, "save-editor");
    await type(el, "department-name", "Brunch");
    expect(fieldError(el, "department-name")).toBeUndefined();
    expect(invalid(el, "department-name")).toBe("false");
    expect(await bottom(el)).toBe(FIX);
    expect(saveDisabled(el)).toBe(true);
    await type(el, "trading-name", "Casa Brunch");
    expect(await bottom(el)).toBe("");
    expect(saveDisabled(el)).toBe(false);
    await type(el, "department-name", " ");
    expect(fieldError(el, "department-name")).toBe("This field is required.");
    expect(await bottom(el)).toBe(FIX);
    expect(saveDisabled(el)).toBe(true);
  });

  // Fails if a refusal that names no field disables Save, marks a field, or outlives the next press.
  it("says a refusal above Save and leaves Save usable, until Save is pressed again", async () => {
    const el = await newDepartment({
      createDepartment: vi
        .fn()
        .mockRejectedValueOnce(new Error("offline"))
        .mockReturnValue(new Promise(() => {})),
    });
    await type(el, "department-name", "Brunch");
    await type(el, "trading-name", "Casa Brunch");
    await action(el, "save-editor");
    expect(await bottom(el)).toBe("The change could not be saved.");
    expect(saveDisabled(el)).toBe(false);
    expect(invalid(el, "department-name")).toBe("false");
    await type(el, "department-name", "");
    expect(await bottom(el)).toBe(`The change could not be saved. ${FIX}`);
    expect(saveDisabled(el)).toBe(true);
    await type(el, "department-name", "Brunch");
    expect(saveDisabled(el)).toBe(false);
    await action(el, "save-editor");
    expect(await bottom(el)).toBe("");
  });

  // Fails if closing and reopening an editor keeps the old attempt's messages or its held Save.
  it("starts clean when the editor is opened again", async () => {
    const el = await newDepartment({
      createDepartment: vi.fn().mockRejectedValue(new Error("offline")),
    });
    await action(el, "save-editor");
    await action(el, "cancel-editor");
    await action(el, "new-department");
    expect(fieldError(el, "department-name")).toBeUndefined();
    expect(await bottom(el)).toBe("");
    expect(saveDisabled(el)).toBe(false);
    await type(el, "department-name", "");
    expect(fieldError(el, "department-name")).toBeUndefined();
    await type(el, "department-name", "Brunch");
    await type(el, "trading-name", "Casa Brunch");
    await action(el, "save-editor");
    expect(await bottom(el)).toBe("The change could not be saved.");
    await action(el, "cancel-editor");
    await action(el, "new-department");
    expect(await bottom(el)).toBe("");
    expect(saveDisabled(el)).toBe(false);
  });

  // Fails if a change reported after the editor has gone is judged: the field holding focus as
  // Escape closes the editor reports its change then.
  it("leaves no message behind when Escape closes an editor with a blank field", async () => {
    const el = await newDepartment();
    await action(el, "save-editor");
    input(el, "department-name").focus();
    await userEvent.keyboard("x{Escape}");
    await vi.waitFor(() => expect(modal(el)).toBeNull());
    await settle(el);
    expect(pageAlert(el)).toBe("");
  });

  // Fails if the Spanish catalogue loses the sentence above Save.
  it("says it in Spanish", async () => {
    setLocale("es");
    const el = await newDepartment();
    await action(el, "save-editor");
    expect(await bottom(el)).toBe("Corrige los campos marcados para continuar.");
  });

  // Fails if a refresh behind the editor clears a refusal the operator has not answered by saving
  // again, or repeats it at the top of the screen.
  it("keeps a refusal above Save when the list refreshes behind the editor", async () => {
    const liveData = new LiveData();
    const load = vi.fn().mockResolvedValue(structuredClone(model));
    const el = await newDepartment({
      load,
      liveData,
      createDepartment: vi.fn().mockRejectedValue(new Error("offline")),
    } as Partial<VenueServiceApi>);
    await type(el, "department-name", "Brunch");
    await type(el, "trading-name", "Casa Brunch");
    await action(el, "save-editor");
    expect(await bottom(el)).toBe("The change could not be saved.");
    const updated = structuredClone(model);
    updated.departments[0]!.name = "Updated elsewhere";
    load.mockResolvedValue(updated);
    liveData.invalidate([{ type: "departments", id: "d1" }]);
    await vi.waitFor(() => expect(tableText(el, "departments")).toContain("Updated elsewhere"));
    expect(await bottom(el)).toBe("The change could not be saved.");
    expect(pageAlert(el)).toBe("");
    expect(saveDisabled(el)).toBe(false);
  });

  // Fails if a refresh failing behind an open editor is said above Save, as though the save had
  // failed, or is said nowhere.
  it("says a failed refresh at the top of the screen while an editor is open, not above Save", async () => {
    const liveData = new LiveData();
    const load = vi.fn().mockResolvedValue(structuredClone(model));
    const el = await newDepartment({ load, liveData } as Partial<VenueServiceApi>);
    load.mockRejectedValue(new Error("offline"));
    liveData.invalidate([{ type: "departments", id: "d1" }]);
    await vi.waitFor(() =>
      expect(pageAlert(el)).toBe("The venue configuration could not be loaded."),
    );
    expect(await bottom(el)).toBe("");
    expect(saveDisabled(el)).toBe(false);
  });

  const REFUSED = "This value was not accepted. Change it and save again.";
  const invalidRequest = (field: string) => ({
    code: "management.request_invalid",
    params: { field },
    status: 400,
  });

  // Fails if a refusal naming a field the editor shows is not put under it, holds Save, survives a
  // change to that field, is cleared by a change to another field, or outlives the editor.
  it("puts a refusal that names a field under that field until that field changes, and leaves Save usable", async () => {
    const el = await newDepartment({
      createDepartment: vi.fn().mockRejectedValue(invalidRequest("tradingName")),
    });
    await type(el, "department-name", "Brunch");
    await type(el, "trading-name", "Casa Brunch");
    await action(el, "save-editor");
    expect(fieldError(el, "trading-name")).toBe(REFUSED);
    expect(invalid(el, "trading-name")).toBe("true");
    expect(fieldError(el, "department-name")).toBeUndefined();
    expect(await bottom(el)).toBe(FIX);
    expect(saveDisabled(el)).toBe(false);
    await vi.waitFor(() => expect(el.shadowRoot!.activeElement).toBe(field(el, "trading-name")));
    await type(el, "department-name", "Brunch bar");
    expect(fieldError(el, "trading-name")).toBe(REFUSED);
    expect(saveDisabled(el)).toBe(false);
    await type(el, "trading-name", "Casa Brunch Bar");
    expect(fieldError(el, "trading-name")).toBeUndefined();
    expect(invalid(el, "trading-name")).toBe("false");
    expect(await bottom(el)).toBe("");
    expect(saveDisabled(el)).toBe(false);
    await action(el, "save-editor");
    expect(fieldError(el, "trading-name")).toBe(REFUSED);
    await action(el, "cancel-editor");
    await action(el, "new-department");
    expect(fieldError(el, "trading-name")).toBeUndefined();
    expect(saveDisabled(el)).toBe(false);
  });

  // Fails if any field the server can name is not mapped onto the control that holds it.
  it.each([
    {
      tab: "departments",
      open: ["edit-department-d1"],
      method: "updateDepartment",
      name: "name",
      control: "department-name",
    },
    {
      tab: "departments",
      open: ["edit-department-d1"],
      method: "updateDepartment",
      name: "tradingName",
      control: "trading-name",
    },
    {
      tab: "departments",
      open: ["edit-department-d1"],
      method: "updateDepartment",
      name: "defaultServiceMode",
      control: "department-mode",
    },
    {
      tab: "zones",
      open: ["edit-zone-z1"],
      method: "configureZone",
      name: "departmentId",
      control: "zone-department-z1",
    },
    {
      tab: "zones",
      open: ["edit-zone-z1"],
      method: "configureZone",
      name: "serviceMode",
      control: "zone-mode-z1",
    },
    {
      tab: "zones",
      open: ["zone-menus-z1", "edit-assignment-m1"],
      method: "allowMenu",
      name: "displayOrder",
      control: "assignment-order",
    },
  ])("puts a refused $name under $control", async ({ tab, open, method, name, control }) => {
    const el = await mount({
      load: vi.fn().mockResolvedValue(model),
      [method]: vi.fn().mockRejectedValue(invalidRequest(name)),
    } as unknown as VenueServiceApi);
    await selectTab(el, tab);
    for (const step of open) await action(el, step);
    await action(el, "save-editor");
    expect(fieldError(el, control)).toBe(REFUSED);
    expect(await bottom(el)).toBe(FIX);
    expect(saveDisabled(el)).toBe(false);
  });

  // Fails if a refusal whose code names one control of the editor is not put under that control, or
  // holds Save.
  it.each([
    {
      tab: "departments",
      open: ["edit-hours-0"],
      method: "replaceHours",
      code: "department.not_found",
      control: "hours-department",
    },
    {
      tab: "zones",
      open: ["edit-zone-z1"],
      method: "configureZone",
      code: "department.not_found",
      control: "zone-department-z1",
    },
    {
      tab: "zones",
      open: ["zone-menus-z1", "edit-assignment-m1"],
      method: "allowMenu",
      code: "catalogue.not_found",
      control: "assignment-menu",
    },
  ])("puts a refused $code under $control", async ({ tab, open, method, code, control }) => {
    const el = await mount({
      load: vi.fn().mockResolvedValue(model),
      [method]: vi.fn().mockRejectedValue({ code, params: {}, status: 404 }),
    } as unknown as VenueServiceApi);
    await selectTab(el, tab);
    for (const step of open) await action(el, step);
    await action(el, "save-editor");
    expect(fieldError(el, control)).toBe(REFUSED);
    expect(await bottom(el)).toBe(FIX);
    expect(saveDisabled(el)).toBe(false);
  });

  // Fails if a refusal naming a field the editor does not show marks a field or holds Save.
  it("says a refusal naming a field the editor does not show above Save, and leaves Save usable", async () => {
    const el = await mount({
      load: vi.fn().mockResolvedValue(model),
      replaceHours: vi.fn().mockRejectedValue(invalidRequest("hours.0")),
    } as unknown as VenueServiceApi);
    await selectTab(el, "departments");
    await action(el, "edit-hours-0");
    await action(el, "save-editor");
    expect(await bottom(el)).toBe("The change could not be saved.");
    expect(el.shadowRoot!.querySelector("[data-field-error]")).toBeNull();
    expect(saveDisabled(el)).toBe(false);
    expect(pageAlert(el)).toBe("");
  });
});

// A list action saves at once, with no form open, so its refusal is the screen's own alert.
it("says a refused list action at the top of the screen, with no editor open", async () => {
  const api = {
    load: vi.fn().mockResolvedValue({
      ...model,
      zoneMenus: [
        ...model.zoneMenus,
        { zoneId: "z1", menuId: "m2", displayOrder: 4, isDefault: false },
      ],
    }),
    allowMenu: vi.fn().mockRejectedValue(new Error("offline")),
  } as unknown as VenueServiceApi;
  const el = await mount(api);
  await selectTab(el, "zones");
  await action(el, "zone-menus-z1");
  await action(el, "default-assignment-m2");
  expect(api.allowMenu).toHaveBeenCalledTimes(1);
  expect(modal(el)).toBeNull();
  expect(pageAlert(el)).toBe("The change could not be saved.");
  expect(el.shadowRoot!.querySelector('[data-test="page-alert"]')!.getAttribute("role")).toBe(
    "alert",
  );
});

it("shows the general save error when a write is refused without a reason", async () => {
  const api = {
    load: vi.fn().mockResolvedValue(model),
    deactivateDepartment: vi.fn().mockRejectedValue(undefined),
  } as unknown as VenueServiceApi;
  const el = await mount(api);
  await selectTab(el, "departments");
  await action(el, "deactivate-department-d2");
  await action(el, "save-editor");
  expect(await bottom(el)).toBe("The change could not be saved.");
  expect(pageAlert(el)).toBe("");
  expect(modal(el)).not.toBeNull();
});

describe("the editor's keyboard", () => {
  it("closes on Escape", async () => {
    const api = {
      load: vi.fn().mockResolvedValue(model),
      createDepartment: vi.fn(),
    } as unknown as VenueServiceApi;
    const el = await mount(api);
    await selectTab(el, "departments");
    await action(el, "new-department");
    input(el, "department-name").focus();
    await userEvent.keyboard("{Escape}");
    // Escape closes the native dialog at once, but the modal leaves only when its close event
    // arrives, which the HTML spec's dialog-closing steps queue as a later task.
    await vi.waitFor(() => expect(modal(el)).toBeNull());
    expect(api.createDepartment).not.toHaveBeenCalled();
  });

  it("stays open on Escape while a save is still pending", async () => {
    let finish!: () => void;
    const api = {
      load: vi.fn().mockResolvedValue(model),
      deactivateDepartment: vi.fn().mockReturnValue(
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
      ),
    } as unknown as VenueServiceApi;
    const el = await mount(api);
    await selectTab(el, "departments");
    await action(el, "deactivate-department-d2");
    find(el, '[data-test="save-editor"]')!.click();
    await el.updateComplete;
    modal(el)!.shadowRoot!.querySelector<HTMLElement>(".body")!.focus();
    await userEvent.keyboard("{Escape}");
    await settle(el);
    expect(modal(el)).not.toBeNull();
    expect(modal(el)!.shadowRoot!.querySelector("dialog")!.open).toBe(true);
    finish();
    await vi.waitFor(() => expect(modal(el)).toBeNull());
  });

  it("saves on Enter in a text field", async () => {
    const api = {
      load: vi.fn().mockResolvedValue(model),
      createDepartment: vi.fn().mockResolvedValue({ id: "d3" }),
    } as unknown as VenueServiceApi;
    const el = await mount(api);
    await selectTab(el, "departments");
    await action(el, "new-department");
    input(el, "trading-name").value = "Casa Delgado Brunch";
    input(el, "department-name").focus();
    await userEvent.keyboard("Brunch{Enter}");
    await vi.waitFor(() => expect(modal(el)).toBeNull());
    expect(api.createDepartment).toHaveBeenCalledWith({
      name: "Brunch",
      tradingName: "Casa Delgado Brunch",
      defaultServiceMode: "prepay",
    });
  });
});

it("returns focus to the row that opened an editor, or to the tabs once that row is gone", async () => {
  const liveData = new LiveData();
  const load = vi.fn().mockResolvedValue(structuredClone(model));
  const el = await mount({ load, liveData } as unknown as VenueServiceApi);
  await selectTab(el, "departments");
  await action(el, "edit-department-d1");
  await action(el, "cancel-editor");
  const menu = table(el, "departments").shadowRoot!.activeElement as HTMLElement;
  expect(menu.getAttribute("label")).toBe("Actions: Restaurant and bar");
  expect(menu.shadowRoot!.activeElement).toBe(menu.shadowRoot!.querySelector("button"));

  await action(el, "edit-department-d2");
  const updated = structuredClone(model);
  updated.departments = [updated.departments[0]!];
  updated.hours = [];
  load.mockResolvedValue(updated);
  liveData.invalidate([{ type: "departments", id: "d2" }]);
  await vi.waitFor(() => expect(column(el, "departments", 0)).toEqual(["Restaurant and bar"]));
  await action(el, "cancel-editor");
  expect(el.shadowRoot!.activeElement).toBe(el.shadowRoot!.querySelector("wt-tabs"));
});

describe("the setting that allows changes to items already sent to the kitchen", () => {
  function kitchenSwitch(el: VenueOperationsScreen) {
    const host = el.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>(
      'wt-switch[name="editSentLines"]',
    )!;
    expect(host).not.toBeNull();
    return { host, input: host.shadowRoot!.querySelector<HTMLInputElement>('[role="switch"]')! };
  }
  function beside(el: VenueOperationsScreen) {
    return el.shadowRoot!.querySelector('[data-field-error="editSentLines"]')?.textContent?.trim();
  }
  function withSetting(editSentLines: boolean): VenueServiceView {
    return { ...structuredClone(model), settings: { editSentLines } };
  }

  // Fails if the switch stops reading the stored value, or loses its label or hint.
  it("shows the stored value on the Changes after sending tab, on by default", async () => {
    const on = await mount({
      load: vi.fn().mockResolvedValue(model),
    } as unknown as VenueServiceApi);
    await selectTab(on, "kitchen");
    const { host, input } = kitchenSwitch(on);
    expect(host.closest('[slot="kitchen"]')).not.toBeNull();
    expect(host.shadowRoot!.querySelector("label")!.textContent).toBe(
      "Allow changes to items already sent to the kitchen",
    );
    expect(input.checked).toBe(true);
    expect(
      on.shadowRoot!.querySelector('[data-test="edit-sent-lines-hint"]')!.textContent,
    ).toContain("cancel it instead");
    const off = await mount({
      load: vi.fn().mockResolvedValue(withSetting(false)),
    } as unknown as VenueServiceApi);
    expect(kitchenSwitch(off).input.checked).toBe(false);
  });

  // Fails if the switch sends the old value rather than the new one, or stays usable mid-save.
  it("saves the chosen value straight away and is disabled until the save finishes", async () => {
    let finish!: () => void;
    const api = {
      load: vi.fn().mockResolvedValueOnce(model).mockResolvedValue(withSetting(false)),
      saveSettings: vi.fn(() => new Promise<void>((resolve) => (finish = resolve))),
    } as unknown as VenueServiceApi;
    const el = await mount(api);
    await selectTab(el, "kitchen");
    kitchenSwitch(el).input.click();
    await settle(el);
    expect(api.saveSettings).toHaveBeenCalledWith({ editSentLines: false });
    expect(kitchenSwitch(el).host.disabled).toBe(true);
    expect(kitchenSwitch(el).input.disabled).toBe(true);
    finish();
    await settle(el);
    expect(api.load).toHaveBeenCalledTimes(2);
    expect(kitchenSwitch(el).input.checked).toBe(false);
    expect(kitchenSwitch(el).input.disabled).toBe(false);
    expect(pageAlert(el)).toBe("");
  });

  // Fails if the in-flight guard goes: two changes arriving before the switch is disabled would
  // both be sent.
  it("sends one save for two changes that arrive before the switch is disabled", async () => {
    const api = {
      load: vi.fn().mockResolvedValue(model),
      saveSettings: vi.fn(() => new Promise<void>(() => {})),
    } as unknown as VenueServiceApi;
    const el = await mount(api);
    const { host } = kitchenSwitch(el);
    for (const checked of [false, true])
      host.dispatchEvent(
        new CustomEvent("wt-change", { detail: { checked }, bubbles: true, composed: true }),
      );
    await settle(el);
    expect(api.saveSettings).toHaveBeenCalledTimes(1);
    expect(api.saveSettings).toHaveBeenCalledWith({ editSentLines: false });
  });

  // Fails if a refused save leaves the switch showing the value that was never stored, or says
  // nothing.
  it("says a refused save failed, beside the switch and at the top of the screen, and shows the stored value again", async () => {
    const api = {
      load: vi.fn().mockResolvedValue(model),
      saveSettings: vi.fn().mockRejectedValue(new Error("offline")),
    } as unknown as VenueServiceApi;
    const el = await mount(api);
    await selectTab(el, "kitchen");
    kitchenSwitch(el).input.click();
    await settle(el);
    expect(api.saveSettings).toHaveBeenCalledWith({ editSentLines: false });
    expect(pageAlert(el)).toContain("could not be saved");
    expect(beside(el)).toContain("could not be saved");
    expect(kitchenSwitch(el).input.checked).toBe(true);
  });

  // Fails if a refresh failing after a stored change is reported as a failed save, or the switch
  // falls back to the value from before the save.
  it("reports a failed refresh after a stored change as a load failure, and keeps the stored value", async () => {
    const api = {
      load: vi.fn().mockResolvedValueOnce(model).mockRejectedValue(new Error("offline")),
      saveSettings: vi.fn().mockResolvedValue(undefined),
    } as unknown as VenueServiceApi;
    const el = await mount(api);
    await selectTab(el, "kitchen");
    kitchenSwitch(el).input.click();
    await settle(el);
    expect(api.load).toHaveBeenCalledTimes(2);
    expect(pageAlert(el)).toContain("could not be loaded");
    expect(pageAlert(el)).not.toContain("could not be saved");
    expect(beside(el)).toBeUndefined();
    expect(kitchenSwitch(el).input.checked).toBe(false);
  });

  // Fails if the screen's live query stops depending on the settings table.
  it("follows a change another dashboard makes", async () => {
    const liveData = new LiveData();
    const load = vi.fn().mockResolvedValue(model);
    const el = await mount({ load, liveData } as unknown as VenueServiceApi);
    expect(kitchenSwitch(el).input.checked).toBe(true);
    load.mockResolvedValue(withSetting(false));
    liveData.invalidate([{ type: "service_settings" }]);
    await vi.waitFor(() => expect(kitchenSwitch(el).input.checked).toBe(false));
  });

  // Fails if the Spanish catalogue loses the label.
  it("reads in Spanish", async () => {
    setLocale("es");
    const el = await mount({
      load: vi.fn().mockResolvedValue(model),
    } as unknown as VenueServiceApi);
    expect(kitchenSwitch(el).host.shadowRoot!.querySelector("label")!.textContent).toBe(
      "Permitir cambios en los artículos ya enviados a cocina",
    );
  });
});

describe("the setting for how identical dishes print on a kitchen ticket", () => {
  function groupingSelect(el: VenueOperationsScreen) {
    const select = el.shadowRoot!.querySelector<HTMLSelectElement>(
      'select[name="kitchenTicketGrouping"]',
    )!;
    expect(select).not.toBeNull();
    return select;
  }
  function beside(el: VenueOperationsScreen) {
    return el
      .shadowRoot!.querySelector('[data-field-error="kitchenTicketGrouping"]')
      ?.textContent?.trim();
  }
  function stored(kitchenTicketGrouping: "combined" | "separate"): VenueServiceView {
    return { ...structuredClone(model), kitchenTicketGrouping };
  }
  async function choose(el: VenueOperationsScreen, value: string) {
    const select = groupingSelect(el);
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await settle(el);
  }

  // Fails if the select stops reading the stored value, or loses its label, choices or hint.
  it("shows the stored value on the Changes after sending tab, combined by default", async () => {
    const combined = await mount({
      load: vi.fn().mockResolvedValue(model),
    } as unknown as VenueServiceApi);
    await selectTab(combined, "kitchen");
    const select = groupingSelect(combined);
    expect(select.closest('[slot="kitchen"]')).not.toBeNull();
    expect(select.labels![0]!.textContent).toContain("Identical dishes on a kitchen ticket");
    expect([...select.options].map((option) => [option.value, option.textContent!.trim()])).toEqual(
      [
        ["combined", "One line: 3 x Burger"],
        ["separate", "A line each: 1 x Burger, three times"],
      ],
    );
    expect(select.value).toBe("combined");
    expect(
      combined.shadowRoot!.querySelector('[data-test="kitchen-ticket-grouping-hint"]')!.textContent,
    ).toContain("reprints");
    const separate = await mount({
      load: vi.fn().mockResolvedValue(stored("separate")),
    } as unknown as VenueServiceApi);
    expect(groupingSelect(separate).value).toBe("separate");
  });

  // Fails if the select sends the old value rather than the new one, or stays usable mid-save.
  it("saves the chosen value straight away and is disabled until the save finishes", async () => {
    let finish!: () => void;
    const api = {
      load: vi.fn().mockResolvedValueOnce(model).mockResolvedValue(stored("separate")),
      saveKitchenTicketGrouping: vi.fn(() => new Promise<void>((resolve) => (finish = resolve))),
    } as unknown as VenueServiceApi;
    const el = await mount(api);
    await selectTab(el, "kitchen");
    await choose(el, "separate");
    expect(api.saveKitchenTicketGrouping).toHaveBeenCalledWith("separate");
    expect(groupingSelect(el).disabled).toBe(true);
    finish();
    await settle(el);
    expect(api.load).toHaveBeenCalledTimes(2);
    expect(groupingSelect(el).value).toBe("separate");
    expect(groupingSelect(el).disabled).toBe(false);
    expect(pageAlert(el)).toBe("");
  });

  // Fails if a refused save leaves the select showing the value that was never stored, or says
  // nothing.
  it("says a refused save failed, beside the select and at the top of the screen, and shows the stored value again", async () => {
    const api = {
      load: vi.fn().mockResolvedValue(model),
      saveKitchenTicketGrouping: vi.fn().mockRejectedValue(new Error("refused")),
    } as unknown as VenueServiceApi;
    const el = await mount(api);
    await selectTab(el, "kitchen");
    await choose(el, "separate");
    expect(api.saveKitchenTicketGrouping).toHaveBeenCalledWith("separate");
    expect(pageAlert(el)).toContain("could not be saved");
    expect(beside(el)).toContain("could not be saved");
    expect(groupingSelect(el).value).toBe("combined");
    expect(groupingSelect(el).getAttribute("aria-invalid")).toBe("true");
  });

  // Fails if the Spanish catalogue loses the label or a choice.
  it("reads in Spanish", async () => {
    setLocale("es");
    const el = await mount({
      load: vi.fn().mockResolvedValue(model),
    } as unknown as VenueServiceApi);
    const select = groupingSelect(el);
    expect(select.labels![0]!.textContent).toContain("Platos iguales en una comanda de cocina");
    expect([...select.options].map((option) => option.textContent!.trim())).toEqual([
      "Una línea: 3 x Hamburguesa",
      "Una por plato: 1 x Hamburguesa, tres veces",
    ]);
  });
});

describe("the setting that prints held groups in advance", () => {
  function printSwitch(el: VenueOperationsScreen) {
    const host = el.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>(
      'wt-switch[name="printHeldWork"]',
    )!;
    expect(host).not.toBeNull();
    return { host, input: host.shadowRoot!.querySelector<HTMLInputElement>('[role="switch"]')! };
  }
  function beside(el: VenueOperationsScreen) {
    return el.shadowRoot!.querySelector('[data-field-error="printHeldWork"]')?.textContent?.trim();
  }
  function stored(printHeldWork: boolean): VenueServiceView {
    return { ...structuredClone(model), printHeldWork };
  }

  // Fails if the switch stops reading the stored value, leaves the kitchen changes section, or
  // loses its label or hint.
  it("shows the stored value on the Changes after sending tab, off by default", async () => {
    const off = await mount({
      load: vi.fn().mockResolvedValue(model),
    } as unknown as VenueServiceApi);
    await selectTab(off, "kitchen");
    const { host, input } = printSwitch(off);
    expect(host.closest('[data-test="kitchen-changes"]')).not.toBeNull();
    expect(host.shadowRoot!.querySelector("label")!.textContent).toBe(
      "Print held groups in advance",
    );
    expect(input.checked).toBe(false);
    expect(
      off.shadowRoot!.querySelector('[data-test="print-held-work-hint"]')!.textContent,
    ).toContain("marked HOLD");
    const on = await mount({
      load: vi.fn().mockResolvedValue(stored(true)),
    } as unknown as VenueServiceApi);
    expect(printSwitch(on).input.checked).toBe(true);
  });

  // Fails if the switch sends the old value rather than the new one, sends it through another
  // setting's save, or stays usable mid-save.
  it("saves the chosen value straight away and is disabled until the save finishes", async () => {
    let finish!: () => void;
    const api = {
      load: vi.fn().mockResolvedValueOnce(model).mockResolvedValue(stored(true)),
      savePrintHeldWork: vi.fn(() => new Promise<void>((resolve) => (finish = resolve))),
      saveSettings: vi.fn(),
    } as unknown as VenueServiceApi;
    const el = await mount(api);
    await selectTab(el, "kitchen");
    printSwitch(el).input.click();
    await settle(el);
    expect(api.savePrintHeldWork).toHaveBeenCalledWith(true);
    expect(api.saveSettings).not.toHaveBeenCalled();
    expect(printSwitch(el).host.disabled).toBe(true);
    expect(printSwitch(el).input.disabled).toBe(true);
    finish();
    await settle(el);
    expect(api.load).toHaveBeenCalledTimes(2);
    expect(printSwitch(el).input.checked).toBe(true);
    expect(printSwitch(el).input.disabled).toBe(false);
    expect(pageAlert(el)).toBe("");
  });

  // Fails if the in-flight guard goes: two changes arriving before the switch is disabled would
  // both be sent.
  it("sends one save for two changes that arrive before the switch is disabled", async () => {
    const api = {
      load: vi.fn().mockResolvedValue(model),
      savePrintHeldWork: vi.fn(() => new Promise<void>(() => {})),
    } as unknown as VenueServiceApi;
    const el = await mount(api);
    const { host } = printSwitch(el);
    for (const checked of [true, false])
      host.dispatchEvent(
        new CustomEvent("wt-change", { detail: { checked }, bubbles: true, composed: true }),
      );
    await settle(el);
    expect(api.savePrintHeldWork).toHaveBeenCalledTimes(1);
    expect(api.savePrintHeldWork).toHaveBeenCalledWith(true);
  });

  // Fails if a refused save leaves the switch showing the value that was never stored, or says
  // nothing.
  it("says a refused save failed, beside the switch and at the top of the screen, and shows the stored value again", async () => {
    const api = {
      load: vi.fn().mockResolvedValue(model),
      savePrintHeldWork: vi.fn().mockRejectedValue(new Error("offline")),
    } as unknown as VenueServiceApi;
    const el = await mount(api);
    await selectTab(el, "kitchen");
    printSwitch(el).input.click();
    await settle(el);
    expect(api.savePrintHeldWork).toHaveBeenCalledWith(true);
    expect(pageAlert(el)).toContain("could not be saved");
    expect(beside(el)).toContain("could not be saved");
    expect(printSwitch(el).input.checked).toBe(false);
  });

  // Fails if the Spanish catalogue loses the label or the hint.
  it("reads in Spanish", async () => {
    setLocale("es");
    const el = await mount({
      load: vi.fn().mockResolvedValue(model),
    } as unknown as VenueServiceApi);
    expect(printSwitch(el).host.shadowRoot!.querySelector("label")!.textContent).toBe(
      "Imprimir por adelantado los grupos en espera",
    );
    expect(
      el.shadowRoot!.querySelector('[data-test="print-held-work-hint"]')!.textContent,
    ).toContain("marcada HOLD");
  });
});

describe("the setting for the reminder to fire the next group", () => {
  function reminderSelect(el: VenueOperationsScreen) {
    const select = el.shadowRoot!.querySelector<HTMLSelectElement>(
      'select[name="releaseReminderMinutes"]',
    )!;
    expect(select).not.toBeNull();
    return select;
  }
  function beside(el: VenueOperationsScreen) {
    return el
      .shadowRoot!.querySelector('[data-field-error="releaseReminderMinutes"]')
      ?.textContent?.trim();
  }
  function stored(releaseReminderMinutes: number | null): VenueServiceView {
    return { ...structuredClone(model), releaseReminderMinutes };
  }
  async function choose(el: VenueOperationsScreen, value: string) {
    const select = reminderSelect(el);
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await settle(el);
  }

  // Fails if the select stops reading the stored value, leaves the kitchen changes section, or
  // loses its label, choices or hint.
  it("shows the stored value on the Changes after sending tab, ten minutes by default", async () => {
    const ten = await mount({
      load: vi.fn().mockResolvedValue(model),
    } as unknown as VenueServiceApi);
    await selectTab(ten, "kitchen");
    const select = reminderSelect(ten);
    expect(select.closest('[data-test="kitchen-changes"]')).not.toBeNull();
    expect(select.labels![0]!.textContent).toContain("Reminder to fire the next group");
    expect([...select.options].map((option) => [option.value, option.textContent!.trim()])).toEqual(
      [
        ["", "Off"],
        ["5", "5 minutes"],
        ["10", "10 minutes"],
        ["15", "15 minutes"],
        ["20", "20 minutes"],
        ["30", "30 minutes"],
      ],
    );
    expect(select.value).toBe("10");
    expect(
      ten.shadowRoot!.querySelector('[data-test="release-reminder-hint"]')!.textContent,
    ).toContain("marked served");
    const off = await mount({
      load: vi.fn().mockResolvedValue(stored(null)),
    } as unknown as VenueServiceApi);
    expect(reminderSelect(off).value).toBe("");
  });

  // Fails if a stored value outside the list reads as another choice.
  it("keeps a stored value the list does not offer", async () => {
    const el = await mount({
      load: vi.fn().mockResolvedValue(stored(45)),
    } as unknown as VenueServiceApi);
    const select = reminderSelect(el);
    expect(select.value).toBe("45");
    expect(select.selectedOptions[0]!.textContent!.trim()).toBe("45 minutes");
  });

  // Fails if the select sends the old value, a string rather than a number, or stays usable mid-save.
  it("saves the chosen minutes straight away, or none for Off, and is disabled until the save finishes", async () => {
    let finish!: () => void;
    const api = {
      load: vi
        .fn()
        .mockResolvedValueOnce(model)
        .mockResolvedValueOnce(stored(20))
        .mockResolvedValue(stored(null)),
      saveReleaseReminderMinutes: vi
        .fn()
        .mockImplementationOnce(() => new Promise<void>((resolve) => (finish = resolve)))
        .mockResolvedValue(undefined),
    } as unknown as VenueServiceApi;
    const el = await mount(api);
    await selectTab(el, "kitchen");
    await choose(el, "20");
    expect(api.saveReleaseReminderMinutes).toHaveBeenCalledWith(20);
    expect(reminderSelect(el).disabled).toBe(true);
    finish();
    await settle(el);
    expect(reminderSelect(el).value).toBe("20");
    expect(reminderSelect(el).disabled).toBe(false);
    await choose(el, "");
    expect(api.saveReleaseReminderMinutes).toHaveBeenLastCalledWith(null);
    expect(api.load).toHaveBeenCalledTimes(3);
    expect(reminderSelect(el).value).toBe("");
    expect(pageAlert(el)).toBe("");
  });

  // Fails if a refused save leaves the select showing the value that was never stored, or says
  // nothing.
  it("says a refused save failed, beside the select and at the top of the screen, and shows the stored value again", async () => {
    const api = {
      load: vi.fn().mockResolvedValue(model),
      saveReleaseReminderMinutes: vi.fn().mockRejectedValue(new Error("refused")),
    } as unknown as VenueServiceApi;
    const el = await mount(api);
    await selectTab(el, "kitchen");
    await choose(el, "5");
    expect(api.saveReleaseReminderMinutes).toHaveBeenCalledWith(5);
    expect(pageAlert(el)).toContain("could not be saved");
    expect(beside(el)).toContain("could not be saved");
    expect(reminderSelect(el).value).toBe("10");
    expect(reminderSelect(el).getAttribute("aria-invalid")).toBe("true");
  });

  // Fails if the Spanish catalogue loses the label or a choice.
  it("reads in Spanish", async () => {
    setLocale("es");
    const el = await mount({
      load: vi.fn().mockResolvedValue(model),
    } as unknown as VenueServiceApi);
    const select = reminderSelect(el);
    expect(select.labels![0]!.textContent).toContain("Aviso para marchar el siguiente grupo");
    expect([...select.options].map((option) => option.textContent!.trim())).toEqual([
      "Desactivado",
      "5 minutos",
      "10 minutos",
      "15 minutos",
      "20 minutos",
      "30 minutos",
    ]);
  });
});

describe("the venue tables at phone width", () => {
  // A long name in each table's first column widens it past a 390 px screen.
  const phoneModel: VenueServiceView = {
    ...model,
    departments: [
      { ...model.departments[0]!, name: "Restaurante, terraza y barra de la planta principal" },
      model.departments[1]!,
    ],
    hours: [
      ...model.hours,
      { departmentId: "d1", weekday: 2, opensAt: "12:00:00", closesAt: "23:00:00" },
    ],
    floorZones: [
      { id: "z1", name: "Comedor principal junto a la terraza del jardín" },
      model.floorZones[1]!,
    ],
    menus: [
      { id: "m1", name: "Carta de temporada de la casa con maridajes y postres", active: true },
      model.menus[1]!,
    ],
  };
  const tables: { name: string; tab: string; open?: string; rows: number }[] = [
    { name: "departments", tab: "departments", rows: phoneModel.departments.length },
    { name: "hours", tab: "departments", rows: phoneModel.hours.length },
    { name: "zones", tab: "zones", rows: phoneModel.floorZones.length },
    { name: "zone-menus", tab: "zones", open: "zone-menus-z1", rows: 1 },
  ];
  it.each(tables.flatMap((table) => ["en", "es"].map((locale) => ({ ...table, locale }))))(
    "keeps every $name row's menu on screen and uncovered while the other columns scroll sideways (390 px, $locale)",
    async ({ name, tab, open, rows, locale }) => {
      const width = window.innerWidth,
        height = window.innerHeight;
      try {
        setLocale(locale);
        await page.viewport(390, 844);
        expect(window.innerWidth).toBe(390);
        const el = await mount({
          load: vi.fn().mockResolvedValue(phoneModel),
        } as unknown as VenueServiceApi);
        await selectTab(el, tab);
        if (open) await action(el, open);
        expectRowMenusOnScreen(table(el, name), rows);
      } finally {
        await page.viewport(width, height);
      }
    },
  );
});
