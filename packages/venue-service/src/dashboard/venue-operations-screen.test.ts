import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { LiveData, setLocale } from "@waitron/dashboard-kit";
import { applyTokens, setContentLanguages } from "@waitron/ui";
import {
  chooseOption,
  expectRowMenusOnScreen,
  formMessageOf,
} from "@waitron/ui/src/test-helpers.js";
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
  clearingWorkflow: false,
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
/** One of the kitchen settings' dropdowns. */
/** A till's starting-zone dropdown. */
type TillZone = HTMLElement & { value: string; options: { value: string; label: string }[] };
/** A dropdown's choices, as the text a person reads. */
function options(box: Element) {
  return (box as Element & { options: { label: string }[] }).options
    .map((option) => option.label)
    .join(" ");
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
/** Types a value the way a person does, into the shared field's own control, so the editor hears
 * the change. */
async function type(el: VenueOperationsScreen, name: string, value: string) {
  const control = field(el, name).shadowRoot!.querySelector("input")!;
  control.value = value;
  control.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  await settle(el);
}
/** Opens a dropdown's list and clicks the row it already shows, as a person can, and returns
 * how many `wt-change` events the dropdown sent. */
async function clickChosenRow(box: HTMLElement): Promise<number> {
  const sent = vi.fn();
  box.addEventListener("wt-change", sent);
  await userEvent.click(box.shadowRoot!.querySelector<HTMLElement>(".trigger")!);
  const row = box.shadowRoot!.querySelector<HTMLElement>('[role="option"][aria-selected="true"]');
  expect(row).not.toBeNull();
  await userEvent.click(row!);
  box.removeEventListener("wt-change", sent);
  return sent.mock.calls.length;
}
/** How many `wt-change` events reach the document while `act` runs. */
async function changesHeardOutside(act: () => Promise<void>): Promise<number> {
  const heard = vi.fn();
  document.addEventListener("wt-change", heard);
  try {
    await act();
  } finally {
    document.removeEventListener("wt-change", heard);
  }
  return heard.mock.calls.length;
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

  it("puts Add department and Add hours under their empty tables' sentence, each opening its editor", async () => {
    const el = await mount({
      load: vi.fn().mockResolvedValue({ ...model, departments: [], hours: [] }),
    } as unknown as VenueServiceApi);
    await selectTab(el, "departments");
    const department = table(el, "departments").querySelector<HTMLElement>(
      ":scope > [slot=empty-action]",
    )!;
    expect(department.assignedSlot).not.toBeNull();
    expect(department.textContent!.trim()).toBe("Add department");
    const hours = table(el, "hours").querySelector<HTMLElement>(":scope > [slot=empty-action]")!;
    expect(hours.assignedSlot).not.toBeNull();
    expect(hours.textContent!.trim()).toBe("Add hours");
    expect(hours.hasAttribute("disabled")).toBe(true);
    department.click();
    await settle(el);
    expect(modal(el)!.getAttribute("heading")).toBe("Add department");
  });

  it("opens the hours editor from the empty hours table's Add hours", async () => {
    const el = await mount({
      load: vi.fn().mockResolvedValue({ ...model, hours: [] }),
    } as unknown as VenueServiceApi);
    await selectTab(el, "departments");
    expect(table(el, "departments").querySelector("[slot=empty-action]")).toBeNull();
    const hours = table(el, "hours").querySelector<HTMLElement>(":scope > [slot=empty-action]")!;
    expect(hours.hasAttribute("disabled")).toBe(false);
    hours.click();
    await settle(el);
    expect(modal(el)!.getAttribute("heading")).toBe("Add hours");
  });

  it("puts Make available under a zone's empty menu table, opening the menu editor", async () => {
    const el = await mount({
      load: vi.fn().mockResolvedValue({ ...model, zoneMenus: [] }),
    } as unknown as VenueServiceApi);
    await selectTab(el, "zones");
    await action(el, "zone-menus-z1");
    const button = table(el, "zone-menus").querySelector<HTMLElement>(
      ":scope > [slot=empty-action]",
    )!;
    expect(button.assignedSlot).not.toBeNull();
    expect(button.textContent!.trim()).toBe("Make available");
    button.click();
    await settle(el);
    expect(modal(el)!.getAttribute("heading")).toBe("Make available");
  });

  const emptySentences = {
    en: {
      departments: "No departments yet.",
      hours: "No opening hours yet.",
      zones: "No service zones yet.",
      tills: "No active tills.",
      "zone-menus": "No menus in this service zone yet.",
    },
    es: {
      departments: "Todavía no hay departamentos.",
      hours: "Todavía no hay horarios de apertura.",
      zones: "Todavía no hay zonas de servicio.",
      tills: "No hay cajas activas.",
      "zone-menus": "Todavía no hay cartas en esta zona de servicio.",
    },
  };
  function emptySentence(el: VenueOperationsScreen, name: string) {
    return table(el, name).shadowRoot!.querySelector(".empty .message")!.textContent;
  }

  it.each(["en", "es"] as const)("says why each empty table has no rows (%s)", async (locale) => {
    setLocale(locale);
    const expected = emptySentences[locale];
    const empty = await mount({
      load: vi.fn().mockResolvedValue({
        ...model,
        departments: [],
        hours: [],
        floorZones: [],
        devices: [],
      }),
    } as unknown as VenueServiceApi);
    await selectTab(empty, "departments");
    expect(emptySentence(empty, "departments")).toBe(expected.departments);
    expect(emptySentence(empty, "hours")).toBe(expected.hours);
    await selectTab(empty, "zones");
    expect(emptySentence(empty, "zones")).toBe(expected.zones);
    expect(emptySentence(empty, "tills")).toBe(expected.tills);

    const allTillsOff = await mount({
      load: vi.fn().mockResolvedValue({
        ...model,
        devices: [{ id: "t2", label: "Old till", kind: "till", active: false }],
      }),
    } as unknown as VenueServiceApi);
    await selectTab(allTillsOff, "zones");
    expect(emptySentence(allTillsOff, "tills")).toBe(expected.tills);

    const noMenus = await mount({
      load: vi.fn().mockResolvedValue({ ...model, zoneMenus: [] }),
    } as unknown as VenueServiceApi);
    await selectTab(noMenus, "zones");
    await action(noMenus, "zone-menus-z1");
    expect(emptySentence(noMenus, "zone-menus")).toBe(expected["zone-menus"]);
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
      load: vi
        .fn()
        .mockResolvedValueOnce(view)
        .mockResolvedValue({ ...view, deviceZones: [{ deviceId: "t1", zoneId: "z1" }] }),
      setDeviceDefaultZone: vi.fn().mockResolvedValue(undefined),
      clearDeviceDefaultZone: vi.fn().mockResolvedValue(undefined),
    } as unknown as VenueServiceApi;
    const el = await mount(api);
    await selectTab(el, "zones");
    expect(tableText(el, "tills")).toContain("Front till");
    expect(tableText(el, "tills")).not.toContain("Kitchen screen");
    expect(tableText(el, "tills")).not.toContain("Old till");
    const selector = table(el, "tills").shadowRoot!.querySelector<TillZone>(
      'wt-combobox[label="Front till: Starts in"]',
    )!;
    expect(selector).not.toBeNull();
    expect(selector.getAttribute("name")).toBe("till-t1-starts-in");
    expect(selector.options[0]!.label).toBe("The venue's counter zone");
    await chooseOption(selector, "z1");
    await settle(el);
    expect(api.setDeviceDefaultZone).toHaveBeenCalledWith("t1", "z1");
    await chooseOption(selector, "");
    await settle(el);
    expect(api.clearDeviceDefaultZone).toHaveBeenCalledWith("t1");
  });
  it("shows a stored starting zone when the zones view first loads", async () => {
    const el = await mount({
      load: vi.fn().mockResolvedValue({
        ...model,
        devices: [{ id: "t1", label: "Front till", kind: "till", active: true }],
        deviceZones: [{ deviceId: "t1", zoneId: "z1" }],
      }),
    } as unknown as VenueServiceApi);
    await selectTab(el, "zones");
    const selector = table(el, "tills").shadowRoot!.querySelector<TillZone>("wt-combobox")!;
    expect(selector.value).toBe("z1");
  });

  it("returns a refused starting-zone choice to the stored counter default", async () => {
    const api = {
      load: vi.fn().mockResolvedValue({
        ...model,
        devices: [{ id: "t1", label: "Front till", kind: "till", active: true }],
        deviceZones: [],
      }),
      setDeviceDefaultZone: vi.fn().mockRejectedValue(new Error("refused")),
    } as unknown as VenueServiceApi;
    const el = await mount(api);
    await selectTab(el, "zones");
    const selector = table(el, "tills").shadowRoot!.querySelector<TillZone>("wt-combobox")!;
    await chooseOption(selector, "z1");
    await settle(el);
    expect(api.setDeviceDefaultZone).toHaveBeenCalledWith("t1", "z1");
    expect(selector.value).toBe("");
    expect(pageAlert(el)).toContain("could not be saved");
  });

  it("restores a stored zone when clearing it is refused", async () => {
    const api = {
      load: vi.fn().mockResolvedValue({
        ...model,
        devices: [{ id: "t1", label: "Front till", kind: "till", active: true }],
        deviceZones: [{ deviceId: "t1", zoneId: "z1" }],
      }),
      clearDeviceDefaultZone: vi.fn().mockRejectedValue(new Error("refused")),
    } as unknown as VenueServiceApi;
    const el = await mount(api);
    await selectTab(el, "zones");
    const selector = table(el, "tills").shadowRoot!.querySelector<TillZone>("wt-combobox")!;
    expect(selector.value).toBe("z1");
    await chooseOption(selector, "");
    await settle(el);
    expect(api.clearDeviceDefaultZone).toHaveBeenCalledWith("t1");
    expect(selector.value).toBe("z1");
    expect(pageAlert(el)).toContain("could not be saved");
  });

  // Fails if choosing the zone a till already starts in saves it again.
  it("saves nothing when the starting zone already shown is chosen again", async () => {
    const api = {
      load: vi.fn().mockResolvedValue({
        ...model,
        devices: [{ id: "t1", label: "Front till", kind: "till", active: true }],
        deviceZones: [{ deviceId: "t1", zoneId: "z1" }],
      }),
      setDeviceDefaultZone: vi.fn().mockResolvedValue(undefined),
      clearDeviceDefaultZone: vi.fn().mockResolvedValue(undefined),
    } as unknown as VenueServiceApi;
    const el = await mount(api);
    await selectTab(el, "zones");
    const selector = table(el, "tills").shadowRoot!.querySelector<TillZone>("wt-combobox")!;
    expect(await clickChosenRow(selector)).toBe(1);
    await settle(el);
    expect(api.setDeviceDefaultZone).not.toHaveBeenCalled();
    expect(api.clearDeviceDefaultZone).not.toHaveBeenCalled();
    expect(api.load).toHaveBeenCalledTimes(1);
    expect(selector.value).toBe("z1");
  });

  it("keeps a starting zone's change inside the screen", async () => {
    const el = await mount({
      load: vi.fn().mockResolvedValue({
        ...model,
        devices: [{ id: "t1", label: "Front till", kind: "till", active: true }],
        deviceZones: [],
      }),
      setDeviceDefaultZone: vi.fn().mockResolvedValue(undefined),
    } as unknown as VenueServiceApi);
    await selectTab(el, "zones");
    const selector = table(el, "tills").shadowRoot!.querySelector<TillZone>("wt-combobox")!;
    expect(await changesHeardOutside(() => chooseOption(selector, "z1"))).toBe(0);
  });

  it.each(["devices", "device_zone_defaults"] as const)(
    "refreshes the till table after %s changes elsewhere",
    async (type) => {
      const liveData = new LiveData();
      const initial = {
        ...model,
        devices: [{ id: "t1", label: "Front till", kind: "till", active: true }],
        deviceZones: [],
      };
      const load = vi.fn().mockResolvedValue(initial);
      const el = await mount({ load, liveData } as unknown as VenueServiceApi);
      await selectTab(el, "zones");
      load.mockResolvedValue({
        ...initial,
        devices: [{ id: "t1", label: "Updated till", kind: "till", active: true }],
        deviceZones: [{ deviceId: "t1", zoneId: "z1" }],
      });
      liveData.invalidate([{ type }]);
      await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(2));
      expect(tableText(el, "tills")).toContain("Updated till");
      expect(table(el, "tills").shadowRoot!.querySelector<TillZone>("wt-combobox")!.value).toBe(
        "z1",
      );
    },
  );

  it.each(["en", "es"] as const)(
    "keeps the %s starting-zone choice readable on a phone",
    async (locale) => {
      const width = window.innerWidth;
      const height = window.innerHeight;
      await page.viewport(390, 844);
      try {
        setLocale(locale);
        const el = await mount({
          load: vi.fn().mockResolvedValue({
            ...model,
            devices: [{ id: "t1", label: "Front till", kind: "till", active: true }],
          }),
        } as unknown as VenueServiceApi);
        hosts.at(-1)!.style.width = "310px";
        await selectTab(el, "zones");
        const root = table(el, "tills").shadowRoot!;
        const scroll = root.querySelector<HTMLElement>(".scroll")!;
        const box = root.querySelector<TillZone>("wt-combobox")!;
        const selector = box.shadowRoot!.querySelector<HTMLElement>(".trigger")!;
        const minimumTapHeight = Number.parseFloat(
          getComputedStyle(selector).getPropertyValue("--wt-tap-min"),
        );
        expect(selector.getBoundingClientRect().height).toBeGreaterThanOrEqual(minimumTapHeight);
        expect(selector.getBoundingClientRect().right).toBeLessThanOrEqual(
          scroll.getBoundingClientRect().right,
        );
        const canvas = document.createElement("canvas");
        const context = canvas.getContext("2d")!;
        // The text's own room, which stops short of the chevron.
        const shown = selector.querySelector<HTMLElement>(".value")!;
        context.font = getComputedStyle(shown).font;
        expect(context.measureText(box.options[0]!.label).width).toBeLessThanOrEqual(
          shown.clientWidth,
        );
      } finally {
        await page.viewport(width, height);
      }
    },
  );
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

  it("holds the department editor's fields and their errors to the form width on a wide window", async () => {
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
      const fields = [...modal(el)!.querySelectorAll(".form wt-input, .form wt-combobox")];
      const parts = [
        ...fields,
        ...fields.flatMap((box) => [...box.shadowRoot!.querySelectorAll("[data-error]")]),
      ];
      expect(parts).toHaveLength(5);
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
    expect(options(field(el, "hours-weekday"))).toContain("Domingo");
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
it("shows three tabs, read-only tables, and creates departments in a cancellable modal", async () => {
  const api = {
    load: vi.fn().mockResolvedValue(model),
    createDepartment: vi.fn(),
  } as unknown as VenueServiceApi;
  const el = await mount(api);
  expect(
    el.shadowRoot!.querySelector("wt-tabs")!.shadowRoot!.querySelectorAll('[role="tab"]'),
  ).toHaveLength(3);
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
  expect(options(field(el, "assignment-menu"))).not.toContain("Casa Delgado");
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
/** The message under a field: the shared field's own `error`. */
function fieldError(el: VenueOperationsScreen, name: string) {
  return (
    el.shadowRoot!.querySelector<HTMLElement & { error: string }>(`[name="${name}"]`)?.error ||
    undefined
  );
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

  it("sorts active tills by their labels", async () => {
    const el = await mount({
      load: vi.fn().mockResolvedValue({
        ...model,
        devices: [
          { id: "t1", label: "Zebra till", kind: "till", active: true },
          { id: "t2", label: "Apple till", kind: "till", active: true },
        ],
      }),
    } as unknown as VenueServiceApi);
    await selectTab(el, "zones");
    expect(column(el, "tills", 0)).toEqual(["Zebra till", "Apple till"]);
    await sortBy(el, "tills", "name");
    expect(column(el, "tills", 0)).toEqual(["Apple till", "Zebra till"]);
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
    table(el, name).shadowRoot!.querySelector(".columns-trigger")!.getAttribute("aria-label");
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
      expect(chooser(el, name)).toBe("Customise columns");
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
    expect(chooser(el, "departments")).toBe("Personalizar columnas");
    expect(chooser(el, "hours")).toBe("Personalizar columnas");
    await selectTab(el, "zones");
    await action(el, "zone-menus-z1");
    expect(chooser(el, "zones")).toBe("Personalizar columnas");
    expect(chooser(el, "zone-menus")).toBe("Personalizar columnas");
  });

  it("words a column that is always shown, and the last one shown, in Spanish", async () => {
    setLocale("es");
    const el = await mount({
      load: vi.fn().mockResolvedValue(model),
    } as unknown as VenueServiceApi);
    await selectTab(el, "departments");
    await selectTab(el, "zones");
    await action(el, "zone-menus-z1");
    for (const name of ["departments", "hours", "zones", "zone-menus"]) {
      const list = table(el, name) as Element & {
        alwaysShownColumnLabel: string;
        lastShownColumnLabel: string;
      };
      expect(list.alwaysShownColumnLabel, name).toBe("Siempre visible");
      expect(list.lastShownColumnLabel, name).toBe("Deja al menos una visible");
    }
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
    return field(el, name)
      .shadowRoot!.querySelector(".field-control")!
      .getAttribute("aria-invalid");
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
    expect(
      [...modal(el)!.querySelectorAll<HTMLElement & { error: string }>("[name]")].filter(
        (box) => box.error,
      ),
    ).toEqual([]);
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

it("returns focus to a row's menu after an edit opened from it is saved", async () => {
  const el = await mount({
    load: vi.fn().mockResolvedValue(model),
    liveData: new LiveData(),
    updateDepartment: vi.fn().mockResolvedValue(undefined),
  } as unknown as VenueServiceApi);
  await selectTab(el, "departments");
  await action(el, "edit-department-d1");
  await action(el, "save-editor");
  await vi.waitFor(() => expect(modal(el)).toBeNull());
  await vi.waitFor(() => {
    const menu = table(el, "departments").shadowRoot!.activeElement as HTMLElement | null;
    expect(menu?.getAttribute("label")).toBe("Actions: Restaurant and bar");
    expect(menu!.shadowRoot!.activeElement).toBe(menu!.shadowRoot!.querySelector("button"));
  });
});

describe("where focus goes after a change that saves at once", () => {
  const withTill: VenueServiceView = {
    ...model,
    zoneMenus: [
      ...model.zoneMenus,
      { zoneId: "z1", menuId: "m2", displayOrder: 1, isDefault: false },
    ],
    devices: [{ id: "t1", label: "Front till", kind: "till", active: true }],
    deviceZones: [],
  };
  /** Waits until the save has reloaded the screen (`load` cleared before the change) and handed
   * its controls back. */
  async function saved(el: VenueOperationsScreen, load: ReturnType<typeof vi.fn>) {
    await vi.waitFor(() => expect(load).toHaveBeenCalledOnce());
    await vi.waitFor(() =>
      expect(find(el, '[data-test="new-assignment-z1"]')!.hasAttribute("disabled")).toBe(false),
    );
    await settle(el);
  }

  it("leaves focus on a till's starting zone after it is changed, though Make available opened an editor earlier", async () => {
    const load = vi.fn().mockResolvedValue(structuredClone(withTill));
    const el = await mount({
      load,
      liveData: new LiveData(),
      setDeviceDefaultZone: vi.fn().mockResolvedValue(undefined),
    } as unknown as VenueServiceApi);
    await selectTab(el, "zones");
    await action(el, "zone-menus-z1");
    await action(el, "new-assignment-z1");
    await action(el, "cancel-editor");
    const makeAvailable = find(el, '[data-test="new-assignment-z1"]')!;
    expect(el.shadowRoot!.activeElement).toBe(makeAvailable);
    load.mockClear();
    load.mockResolvedValue({
      ...structuredClone(withTill),
      deviceZones: [{ deviceId: "t1", zoneId: "z1" }],
    });
    const selector = table(el, "tills").shadowRoot!.querySelector<TillZone>("wt-combobox")!;
    await userEvent.click(selector.shadowRoot!.querySelector<HTMLElement>(".trigger")!);
    const row = [...selector.shadowRoot!.querySelectorAll<HTMLElement>('[role="option"]')].find(
      (option) => option.textContent!.trim() === "Dining room",
    )!;
    await userEvent.click(row);
    await saved(el, load);
    expect(el.shadowRoot!.activeElement).not.toBe(makeAvailable);
    expect(table(el, "tills").shadowRoot!.activeElement).toBe(selector);
  });

  it("leaves focus on a zone menu's row menu after Make default", async () => {
    const load = vi.fn().mockResolvedValue(structuredClone(withTill));
    const el = await mount({
      load,
      liveData: new LiveData(),
      allowMenu: vi.fn().mockResolvedValue(undefined),
    } as unknown as VenueServiceApi);
    await selectTab(el, "zones");
    await action(el, "zone-menus-z1");
    await action(el, "new-assignment-z1");
    await action(el, "cancel-editor");
    const menu = table(el, "zone-menus").shadowRoot!.querySelector<HTMLElement>(
      'wt-row-actions[label="Actions: Deli takeaway"]',
    )!;
    await userEvent.click(menu.shadowRoot!.querySelector<HTMLElement>("button")!);
    load.mockClear();
    await userEvent.click(find(el, '[data-test="default-assignment-m2"]')!);
    await saved(el, load);
    expect(el.shadowRoot!.activeElement).not.toBe(find(el, '[data-test="new-assignment-z1"]'));
    const focused = table(el, "zone-menus").shadowRoot!.activeElement as HTMLElement | null;
    expect(focused?.getAttribute("label")).toBe("Actions: Deli takeaway");
    expect(focused!.shadowRoot!.activeElement).toBe(focused!.shadowRoot!.querySelector("button"));
  });
});

describe("where focus goes when an editor opened from an Add button closes", () => {
  /** An api whose writes change what the next load returns, as the server's do. */
  function writingApi(start: Partial<VenueServiceView>) {
    const view: VenueServiceView = { ...structuredClone(model), ...start };
    return {
      load: vi.fn(async () => structuredClone(view)),
      liveData: new LiveData(),
      createDepartment: vi.fn(async () => {
        const made = {
          id: "d3",
          name: "Events",
          tradingName: "Casa Events",
          defaultServiceMode: "prepay" as const,
          active: true,
        };
        view.departments = [...view.departments, made];
        return made;
      }),
      replaceHours: vi.fn(
        async (
          departmentId: string,
          hours: { weekday: number; opensAt: string; closesAt: string }[],
        ) => {
          view.hours = [
            ...view.hours.filter((row) => row.departmentId !== departmentId),
            ...hours.map((row) => ({
              departmentId,
              weekday: row.weekday,
              opensAt: `${row.opensAt}:00`,
              closesAt: `${row.closesAt}:00`,
            })),
          ];
        },
      ),
      allowMenu: vi.fn(
        async (
          zoneId: string,
          menuId: string,
          input: { displayOrder: number; makeDefault: boolean },
        ) => {
          view.zoneMenus = [
            ...view.zoneMenus.filter((row) => row.zoneId !== zoneId || row.menuId !== menuId),
            { zoneId, menuId, displayOrder: input.displayOrder, isDefault: input.makeDefault },
          ];
        },
      ),
    };
  }
  const tables: {
    table: string;
    add: string;
    empty: Partial<VenueServiceView>;
    write: "createDepartment" | "replaceHours" | "allowMenu";
    show: (el: VenueOperationsScreen) => Promise<void>;
    fill: (el: VenueOperationsScreen) => void;
  }[] = [
    {
      table: "departments",
      add: "new-department",
      empty: { departments: [], hours: [] },
      write: "createDepartment",
      show: (el: VenueOperationsScreen) => selectTab(el, "departments"),
      fill: (el: VenueOperationsScreen) => {
        field(el, "department-name").value = "Events";
        field(el, "trading-name").value = "Casa Events";
      },
    },
    {
      table: "hours",
      add: "new-hours",
      empty: { hours: [] },
      write: "replaceHours",
      show: (el: VenueOperationsScreen) => selectTab(el, "departments"),
      fill: (el: VenueOperationsScreen) => {
        field(el, "hours-opens").value = "09:00";
        field(el, "hours-closes").value = "17:00";
      },
    },
    {
      table: "zone-menus",
      add: "new-assignment-z1",
      empty: { zoneMenus: [] },
      write: "allowMenu",
      show: async (el: VenueOperationsScreen) => {
        await selectTab(el, "zones");
        await action(el, "zone-menus-z1");
      },
      fill: () => {},
    },
  ];
  function top(el: VenueOperationsScreen, add: string) {
    const button = el.shadowRoot!.querySelector<HTMLElement>(
      `wt-tabs > [slot="actions"] [data-test="${add}"]`,
    );
    expect(button, add).not.toBeNull();
    return button!;
  }
  function inBox(el: VenueOperationsScreen, name: string) {
    return table(el, name).querySelector<HTMLElement>(":scope > [slot=empty-action]");
  }

  it.each(tables)(
    "returns focus to the top Add after the first row is made from the empty $table table's button",
    async ({ table: name, add, empty, write, show, fill }) => {
      const api = writingApi(empty);
      const el = await mount(api as unknown as VenueServiceApi);
      await show(el);
      inBox(el, name)!.click();
      await settle(el);
      fill(el);
      await action(el, "save-editor");
      expect(api[write]).toHaveBeenCalledOnce();
      await vi.waitFor(() => expect(inBox(el, name)).toBeNull());
      await vi.waitFor(() => expect(el.shadowRoot!.activeElement).toBe(top(el, add)));
    },
  );

  it.each(tables)(
    "returns focus to the empty $table table's button after Cancel",
    async ({ table: name, empty, show }) => {
      const el = await mount(writingApi(empty) as unknown as VenueServiceApi);
      await show(el);
      const button = inBox(el, name)!;
      button.click();
      await settle(el);
      await action(el, "cancel-editor");
      expect(modal(el)).toBeNull();
      expect(el.shadowRoot!.activeElement).toBe(button);
    },
  );

  it.each(tables)(
    "keeps focus on the top Add after it adds to the $table table when it already has rows",
    async ({ add, write, show, fill }) => {
      const api = writingApi({});
      const el = await mount(api as unknown as VenueServiceApi);
      await show(el);
      const button = top(el, add);
      button.click();
      await settle(el);
      fill(el);
      await action(el, "save-editor");
      expect(api[write]).toHaveBeenCalledOnce();
      await vi.waitFor(() => expect(el.shadowRoot!.activeElement).toBe(button));
    },
  );

  it("draws no button in the hours or a zone's menu table once they have rows", async () => {
    const el = await mount(writingApi({}) as unknown as VenueServiceApi);
    await selectTab(el, "departments");
    expect(inBox(el, "hours")).toBeNull();
    await selectTab(el, "zones");
    await action(el, "zone-menus-z1");
    expect(inBox(el, "zone-menus")).toBeNull();
  });
});

describe("the venue screen's fields are the shared field components", () => {
  type Box = HTMLElement & {
    value: string;
    label: string;
    required: boolean;
    disabled: boolean;
    hint: string;
    placeholder: string;
    error: string;
    updateComplete: Promise<unknown>;
  };
  type Dropdown = Box & {
    search: string;
    hideLabel: boolean;
    options: { value: string; label: string }[];
    searchPlaceholder: string;
    noResultsLabel: string;
  };
  type Stepper = Box & {
    min: number;
    decreaseLabel: (label: string) => string;
    increaseLabel: (label: string) => string;
  };
  function dropdown(root: ParentNode, name: string) {
    const box = root.querySelector<Dropdown>(`wt-combobox[name="${name}"]`)!;
    expect(box, name).not.toBeNull();
    return box;
  }
  function textBox(el: VenueOperationsScreen, name: string) {
    const box = el.shadowRoot!.querySelector<Box & { type: string }>(`wt-input[name="${name}"]`)!;
    expect(box, name).not.toBeNull();
    return box;
  }
  const options = (box: Dropdown) => box.options.map((option) => [option.value, option.label]);

  // Fails if a department field stops being the shared one, or the screen stops reading what is
  // typed or chosen in it.
  it("saves a new department from what is typed and chosen in its fields", async () => {
    const api = {
      load: vi.fn().mockResolvedValue(model),
      createDepartment: vi.fn().mockResolvedValue({ id: "d3" }),
    } as unknown as VenueServiceApi;
    const el = await mount(api);
    await selectTab(el, "departments");
    await action(el, "new-department");
    const name = textBox(el, "department-name");
    expect([name.label, name.required, name.type]).toEqual(["Department name", true, "text"]);
    const trading = textBox(el, "trading-name");
    expect([trading.label, trading.required]).toEqual(["Trading name", true]);
    const mode = dropdown(el.shadowRoot!, "department-mode");
    expect([mode.label, mode.required, mode.search, mode.value]).toEqual([
      "Service style",
      true,
      "auto",
      "prepay",
    ]);
    expect(options(mode)).toEqual([
      ["table_tab", "Table service"],
      ["prepay", "Pay before preparation"],
      ["invoice_first", "Pay then prepare"],
      ["ticket_then_pay", "Prepare then pay"],
    ]);
    await type(el, "department-name", "Events");
    await type(el, "trading-name", "Casa Delgado Events");
    await chooseOption(mode, "invoice_first");
    await action(el, "save-editor");
    expect(api.createDepartment).toHaveBeenCalledWith({
      name: "Events",
      tradingName: "Casa Delgado Events",
      defaultServiceMode: "invoice_first",
    });
  });

  // Fails if a dropdown given no value stops starting on its first choice, or the times stop
  // being read from the shared time fields.
  it("opens new hours on the first department and Sunday, and saves the times typed", async () => {
    const api = {
      load: vi.fn().mockResolvedValue(model),
      replaceHours: vi.fn().mockResolvedValue(undefined),
    } as unknown as VenueServiceApi;
    const el = await mount(api);
    await selectTab(el, "departments");
    await action(el, "new-hours");
    const department = dropdown(el.shadowRoot!, "hours-department");
    expect([department.label, department.required, department.search, department.value]).toEqual([
      "Department",
      true,
      "auto",
      "d1",
    ]);
    expect(options(department)).toEqual([
      ["d1", "Restaurant and bar"],
      ["d2", "Deli"],
    ]);
    const day = dropdown(el.shadowRoot!, "hours-weekday");
    expect([day.label, day.required, day.search, day.value]).toEqual(["Day", true, "auto", "0"]);
    expect(options(day).map(([value]) => value)).toEqual(["0", "1", "2", "3", "4", "5", "6"]);
    for (const [key, label] of [
      ["hours-opens", "Opens"],
      ["hours-closes", "Closes"],
    ] as const) {
      const time = textBox(el, key);
      expect([time.label, time.required, time.type]).toEqual([label, true, "time"]);
    }
    await chooseOption(day, "3");
    await type(el, "hours-opens", "11:00");
    await type(el, "hours-closes", "20:00");
    await action(el, "save-editor");
    expect(api.replaceHours).toHaveBeenCalledWith("d1", [
      { weekday: 3, opensAt: "11:00", closesAt: "20:00" },
    ]);
  });

  // Fails if the zone's own service style loses its "use the department's" choice, or a zone with
  // no department stops starting on the first active one.
  it("offers a zone the department's service style as a choice and as the text shown for it", async () => {
    const api = {
      load: vi.fn().mockResolvedValue(model),
      configureZone: vi.fn().mockResolvedValue(undefined),
    } as unknown as VenueServiceApi;
    const el = await mount(api);
    await selectTab(el, "zones");
    await action(el, "edit-zone-z1");
    const department = dropdown(el.shadowRoot!, "zone-department-z1");
    expect([department.required, department.search, department.value]).toEqual([
      true,
      "auto",
      "d1",
    ]);
    const mode = dropdown(el.shadowRoot!, "zone-mode-z1");
    expect([mode.label, mode.required, mode.search, mode.placeholder, mode.value]).toEqual([
      "Service style",
      false,
      "auto",
      "Use department default",
      "prepay",
    ]);
    expect(options(mode)[0]).toEqual(["", "Use department default"]);
    await chooseOption(mode, "");
    await action(el, "save-editor");
    expect(api.configureZone).toHaveBeenCalledWith("z1", { departmentId: "d1", serviceMode: null });
    await action(el, "edit-zone-z2");
    expect(dropdown(el.shadowRoot!, "zone-department-z2").value).toBe("d1");
  });

  // Fails if the display order stops being a stepper that counts from zero, or its buttons lose
  // their names.
  it("steps a menu's display order and saves it", async () => {
    const api = {
      load: vi.fn().mockResolvedValue(model),
      allowMenu: vi.fn().mockResolvedValue(undefined),
    } as unknown as VenueServiceApi;
    const el = await mount(api);
    await selectTab(el, "zones");
    await action(el, "zone-menus-z1");
    await action(el, "new-assignment-z1");
    const menu = dropdown(el.shadowRoot!, "assignment-menu");
    expect([menu.label, menu.required, menu.search, menu.value]).toEqual([
      "Menu name",
      true,
      "auto",
      "m2",
    ]);
    expect(options(menu)).toEqual([["m2", "Deli takeaway"]]);
    const order = el.shadowRoot!.querySelector<Stepper>(
      'wt-number-stepper[name="assignment-order"]',
    )!;
    expect(order).not.toBeNull();
    expect([order.label, order.required, order.min, order.value]).toEqual([
      "Display order",
      true,
      0,
      "1",
    ]);
    expect(order.decreaseLabel(order.label)).toBe("Decrease Display order");
    expect(order.increaseLabel(order.label)).toBe("Increase Display order");
    order.shadowRoot!.querySelector<HTMLButtonElement>('[data-step="1"]')!.click();
    await settle(el);
    expect(order.value).toBe("2");
    await action(el, "save-editor");
    expect(api.allowMenu).toHaveBeenCalledWith("z1", "m2", { displayOrder: 2, makeDefault: false });
  });

  // Fails if the editor stops hearing a dropdown's change: a refusal under it must go once it is
  // changed.
  it("clears a refusal under a dropdown once another choice is made", async () => {
    const el = await mount({
      load: vi.fn().mockResolvedValue(model),
      updateDepartment: vi.fn().mockRejectedValue({
        code: "management.request_invalid",
        params: { field: "defaultServiceMode" },
        status: 400,
      }),
    } as unknown as VenueServiceApi);
    await selectTab(el, "departments");
    await action(el, "edit-department-d1");
    await action(el, "save-editor");
    const mode = dropdown(el.shadowRoot!, "department-mode");
    expect(mode.error).toBe("This value was not accepted. Change it and save again.");
    await chooseOption(mode, "prepay");
    await settle(el);
    expect(mode.error).toBe("");
  });

  // Fails if the editor stops hearing a typed change: a field's message must go once it is fixed.
  it("clears a field's message once it is typed into after a failed save", async () => {
    const el = await mount({
      load: vi.fn().mockResolvedValue(model),
      createDepartment: vi.fn(),
    } as unknown as VenueServiceApi);
    await selectTab(el, "departments");
    await action(el, "new-department");
    await action(el, "save-editor");
    const name = textBox(el, "department-name");
    expect(name.error).toBe("This field is required.");
    const control = name.shadowRoot!.querySelector("input")!;
    control.value = "Brunch";
    control.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    await settle(el);
    expect(name.error).toBe("");
  });

  // Fails if a till's starting zone stops being a compact dropdown named for its till.
  it("draws each till's starting zone as a compact dropdown named for the till", async () => {
    const el = await mount({
      load: vi.fn().mockResolvedValue({
        ...model,
        devices: [{ id: "t1", label: "Front till", kind: "till", active: true }],
      }),
    } as unknown as VenueServiceApi);
    await selectTab(el, "zones");
    const zone = table(el, "tills").shadowRoot!.querySelector<Dropdown>("wt-combobox")!;
    expect(zone).not.toBeNull();
    expect([zone.label, zone.hideLabel, zone.search, zone.placeholder, zone.value]).toEqual([
      "Front till: Starts in",
      true,
      "auto",
      "The venue's counter zone",
      "",
    ]);
    expect(options(zone)).toEqual([
      ["", "The venue's counter zone"],
      ["z1", "Dining room"],
    ]);
  });

  // Fails if the Spanish catalogue loses the dropdowns' search wording or the stepper's buttons.
  it("words the dropdowns' search and the stepper's buttons in Spanish", async () => {
    setLocale("es");
    const el = await mount({
      load: vi.fn().mockResolvedValue(model),
    } as unknown as VenueServiceApi);
    await selectTab(el, "zones");
    await action(el, "zone-menus-z1");
    await action(el, "new-assignment-z1");
    const menu = dropdown(el.shadowRoot!, "assignment-menu");
    expect([menu.searchPlaceholder, menu.noResultsLabel]).toEqual(["Buscar", "Sin resultados"]);
    const order = el.shadowRoot!.querySelector<Stepper>(
      'wt-number-stepper[name="assignment-order"]',
    )!;
    expect(order.decreaseLabel("Orden")).toBe("Reducir Orden");
    expect(order.increaseLabel("Orden")).toBe("Aumentar Orden");
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
