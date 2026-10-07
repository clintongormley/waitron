import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { LiveData, setLocale } from "@waitron/dashboard-kit";
import { applyTokens, NavigationGuard, setContentLanguages } from "@waitron/ui";
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
  salePolicies: { departments: [], zones: [] },
  floorZones: [
    { id: "z1", name: "Dining room" },
    { id: "z2", name: "Deli counter" },
  ],
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
  if (name === "cancel-editor") {
    await expect.poll(() => el.shadowRoot!.querySelector("wt-modal")).toBeNull();
  }
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
  it("shows the departments and zones policy tree when the screen opens", async () => {
    const el = await mount({
      load: vi.fn().mockResolvedValue(model),
    } as unknown as VenueServiceApi);
    const tree = table(el, "policy-tree");
    expect(tree.getBoundingClientRect().height).toBeGreaterThan(0);
    expect(tree.shadowRoot!.textContent).toContain("Dining room");
  });

  it("places the unified policy tree before the remaining legacy controls", async () => {
    const el = await mount({
      load: vi.fn().mockResolvedValue(model),
    } as unknown as VenueServiceApi);
    const tree = table(el, "policy-tree");
    const legacy = el.shadowRoot!.querySelector("wt-tabs")!;
    expect(tree.compareDocumentPosition(legacy) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("shows venue readiness beneath the policy tree without a separate Status tab", async () => {
    const el = await mount({
      load: vi.fn().mockResolvedValue(model),
    } as unknown as VenueServiceApi);
    const tree = table(el, "policy-tree");
    const readiness = el.shadowRoot!.querySelector<HTMLElement>('[data-test="readiness"]')!;
    const tabs = [
      ...el.shadowRoot!.querySelector("wt-tabs")!.shadowRoot!.querySelectorAll('[role="tab"]'),
    ];
    expect(readiness.textContent).toContain("default prep station");
    expect(tree.compareDocumentPosition(readiness) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(tabs.map((tab) => tab.getAttribute("data-key"))).toEqual(["departments", "zones"]);
  });

  it("has no department hours section of its own: hours live on the Hours page", async () => {
    const el = await mount({
      load: vi.fn().mockResolvedValue(model),
    } as unknown as VenueServiceApi);
    for (const tab of ["departments", "zones"]) {
      await selectTab(el, tab);
      expect(el.shadowRoot!.querySelector('[data-test="hours"]')).toBeNull();
      expect(el.shadowRoot!.querySelector('[data-test="hours-actions"]')).toBeNull();
      expect(find(el, '[data-test="new-hours"]')).toBeNull();
    }
    expect(table(el, "policy-tree")).not.toBeNull();
  });

  it("opens a new department from the policy tree's top action", async () => {
    const el = await mount({
      load: vi.fn().mockResolvedValue(model),
    } as unknown as VenueServiceApi);
    const tree = table(el, "policy-tree");
    const add = el.shadowRoot!.querySelector<HTMLElement>(
      '[data-test="policy-tree-actions"] [data-test="new-department"]',
    );
    expect(add).not.toBeNull();
    expect(add!.compareDocumentPosition(tree) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    add!.click();
    await settle(el);
    expect(modal(el)?.getAttribute("heading")).toBe("Add department");
  });

  it("edits a department's retained service style from its policy-tree row", async () => {
    const updateDepartment = vi.fn().mockResolvedValue(undefined);
    const el = await mount({
      load: vi.fn().mockResolvedValue(model),
      updateDepartment,
    } as unknown as VenueServiceApi);
    await action(el, "edit-tree-department-d1");
    expect(modal(el)?.getAttribute("heading")).toBe("Edit department");
    expect(field(el, "department-mode").value).toBe("table_tab");
    field(el, "department-mode").value = "prepay";
    await action(el, "save-editor");
    expect(updateDepartment).toHaveBeenCalledWith("d1", {
      name: "Restaurant and bar",
      tradingName: "Casa Delgado",
      defaultServiceMode: "prepay",
    });
  });

  it("offers one Add department action above the policy tree", async () => {
    const el = await mount({
      load: vi.fn().mockResolvedValue(model),
    } as unknown as VenueServiceApi);
    const actions = el.shadowRoot!.querySelectorAll<HTMLElement>('[data-test="new-department"]');
    expect(actions).toHaveLength(1);
    expect(actions[0]!.closest('[data-test="policy-tree-actions"]')).not.toBeNull();
    actions[0]!.click();
    await settle(el);
    expect(modal(el)?.getAttribute("heading")).toBe("Add department");
  });

  it.each(["en", "es"] as const)(
    "keeps the %s policy tree actions apart on a phone",
    async (locale) => {
      const width = window.innerWidth;
      const height = window.innerHeight;
      try {
        await page.viewport(390, 844);
        setLocale(locale);
        const el = await mount({
          load: vi.fn().mockResolvedValue(model),
        } as unknown as VenueServiceApi);
        const actions = el.shadowRoot!.querySelector('[data-test="policy-tree-actions"]')!;
        const department = actions.querySelector<HTMLElement>('[data-test="new-department"]')!;
        const zone = actions.querySelector<HTMLElement>('[data-test="new-zone"]')!;
        const first = department.getBoundingClientRect();
        const second = zone.getBoundingClientRect();
        expect(
          Math.max(second.left - first.right, second.top - first.bottom),
        ).toBeGreaterThanOrEqual(8);
      } finally {
        await page.viewport(width, height);
      }
    },
  );

  it("creates a new zone under the chosen department from the policy tree", async () => {
    const createZone = vi.fn().mockResolvedValue({ id: "z3" });
    const el = await mount({
      load: vi.fn().mockResolvedValue(model),
      createZone,
    } as unknown as VenueServiceApi);
    const add = el.shadowRoot!.querySelector<HTMLElement>(
      '[data-test="policy-tree-actions"] [data-test="new-zone"]',
    );
    expect(add).not.toBeNull();
    add!.click();
    await settle(el);
    expect(modal(el)?.getAttribute("heading")).toBe("New zone");
    expect(field(el, "new-zone-name").getAttribute("label")).toBe("Zone name");
    await type(el, "new-zone-name", "Garden");
    const department = field(el, "new-zone-department") as HTMLElement & { value: string };
    department.value = "d2";
    department.dispatchEvent(
      new CustomEvent("wt-change", { bubbles: true, detail: { value: "d2" } }),
    );
    await action(el, "save-editor");
    expect(createZone).toHaveBeenCalledWith({ name: "Garden", departmentId: "d2" });
  });

  it("refuses a blank new zone name before sending a create request", async () => {
    const createZone = vi.fn();
    const el = await mount({
      load: vi.fn().mockResolvedValue(model),
      createZone,
    } as unknown as VenueServiceApi);
    await action(el, "new-zone");
    await action(el, "save-editor");
    expect(fieldError(el, "new-zone-name")).toBe("This field is required.");
    expect(createZone).not.toHaveBeenCalled();
  });

  it("shows a duplicate new zone name beside the field and keeps the draft", async () => {
    const createZone = vi.fn().mockRejectedValue({ code: "zone.name_taken" });
    const el = await mount({
      load: vi.fn().mockResolvedValue(model),
      createZone,
    } as unknown as VenueServiceApi);
    await action(el, "new-zone");
    await type(el, "new-zone-name", "Garden");
    const department = field(el, "new-zone-department") as HTMLElement & { value: string };
    department.value = "d2";
    department.dispatchEvent(
      new CustomEvent("wt-change", { bubbles: true, detail: { value: "d2" } }),
    );
    await action(el, "save-editor");
    expect(createZone).toHaveBeenCalledWith({ name: "Garden", departmentId: "d2" });
    expect(fieldError(el, "new-zone-name")).toBeTruthy();
    expect((field(el, "new-zone-name") as HTMLElement & { value: string }).value).toBe("Garden");
  });

  it("renames a zone from its policy-tree cell", async () => {
    const updateZone = vi.fn().mockResolvedValue(undefined);
    const el = await mount({
      load: vi.fn().mockResolvedValue(model),
      updateZone,
    } as unknown as VenueServiceApi);
    const tree = table(el, "policy-tree").shadowRoot!;
    tree.querySelector<HTMLButtonElement>('[data-test="edit-zone-name"]')!.click();
    await settle(el);
    const input = tree
      .querySelector('wt-input[name="zoneName"]')!
      .shadowRoot!.querySelector("input")!;
    input.value = "Garden room";
    input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    tree.querySelector<HTMLButtonElement>('[data-test="save-zone-name"]')!.click();
    await vi.waitFor(() => expect(updateZone).toHaveBeenCalledWith("z1", { name: "Garden room" }));
  });

  it("keeps a zone rename open and reports a rejected save", async () => {
    setLocale("es");
    const updateZone = vi.fn().mockRejectedValue({ code: "zone.not_found" });
    const el = await mount({
      load: vi.fn().mockResolvedValue(model),
      updateZone,
    } as unknown as VenueServiceApi);
    const tree = table(el, "policy-tree").shadowRoot!;
    tree.querySelector<HTMLButtonElement>('[data-test="edit-zone-name"]')!.click();
    await settle(el);
    const input = tree
      .querySelector('wt-input[name="zoneName"]')!
      .shadowRoot!.querySelector("input")!;
    input.value = "Garden room";
    input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    tree.querySelector<HTMLButtonElement>('[data-test="save-zone-name"]')!.click();
    await vi.waitFor(() => expect(updateZone).toHaveBeenCalledWith("z1", { name: "Garden room" }));
    await settle(el);
    expect(tree.querySelector('wt-input[name="zoneName"]')).not.toBeNull();
    expect(pageAlert(el)).toBe("No se pudo guardar el cambio.");
  });

  it("shows a zone's readiness problem beneath that zone in the policy table", async () => {
    const el = await mount({
      load: vi.fn().mockResolvedValue({
        ...model,
        readiness: [{ code: "zone.menu_missing", zoneId: "z1", zoneName: "Dining room" }],
      }),
    } as unknown as VenueServiceApi);
    const rows = [...table(el, "policy-tree").shadowRoot!.querySelectorAll('tbody [role="row"]')];
    const zone = rows.find((row) => row.textContent?.includes("Dining room"));
    expect(zone).toBeDefined();
    expect(zone!.querySelector('[data-test="zone-readiness"]')?.textContent).toContain(
      "needs a default menu",
    );
    expect(
      rows
        .filter((row) => row !== zone)
        .every((row) => row.querySelector('[data-test="zone-readiness"]') === null),
    ).toBe(true);
  });

  it("links a zone's missing-menu warning to its department's menu timetable", async () => {
    const el = await mount({
      load: vi.fn().mockResolvedValue({
        ...model,
        readiness: [{ code: "zone.menu_missing", zoneId: "z1", zoneName: "Dining room" }],
      }),
    } as unknown as VenueServiceApi);
    const tree = table(el, "policy-tree").shadowRoot!;
    const zone = [...tree.querySelectorAll('tbody [role="row"]')].find((row) =>
      row.textContent?.includes("Dining room"),
    )!;
    const action = zone.querySelector<HTMLAnchorElement>('[data-test="zone-readiness-action"]');
    expect(action).not.toBeNull();
    expect(action!.textContent).toContain("Set one up in Menu timetable");
    expect(action!.getAttribute("href")).toBe("/manage/menu-timetable/department/d1");
    // A plain link: the dashboard's same-app link handler navigates in the app.
    const before = location.href;
    let reachedBrowser = false;
    const blockDefault = (event: MouseEvent) => {
      reachedBrowser = !event.defaultPrevented;
      event.preventDefault();
    };
    document.addEventListener("click", blockDefault, { once: true });
    action!.click();
    document.removeEventListener("click", blockDefault);
    await settle(el);
    expect(reachedBrowser).toBe(true);
    expect(location.href).toBe(before);
    expect(modal(el)).toBeNull();
  });

  it.each(["shift", "alt"] as const)(
    "leaves a click with %s held on the menu timetable link to the browser",
    async (kind) => {
      const el = await mount({
        load: vi.fn().mockResolvedValue({
          ...model,
          readiness: [{ code: "zone.menu_missing", zoneId: "z1", zoneName: "Dining room" }],
        }),
      } as unknown as VenueServiceApi);
      const tree = table(el, "policy-tree").shadowRoot!;
      const action = tree.querySelector<HTMLAnchorElement>('[data-test="zone-readiness-action"]')!;
      const before = location.href;
      let reachedBrowser = false;
      const blockDefault = (event: MouseEvent) => {
        reachedBrowser = !event.defaultPrevented;
        event.preventDefault();
      };
      document.addEventListener("click", blockDefault, { once: true });
      action.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          composed: true,
          cancelable: true,
          shiftKey: kind === "shift",
          altKey: kind === "alt",
        }),
      );
      document.removeEventListener("click", blockDefault);
      await settle(el);
      expect(reachedBrowser).toBe(true);
      expect(location.href).toBe(before);
    },
  );

  it("renames a department from its table cell", async () => {
    const updateDepartment = vi.fn().mockResolvedValue(undefined);
    const el = await mount({
      load: vi.fn().mockResolvedValue(model),
      updateDepartment,
    } as unknown as VenueServiceApi);
    const tree = table(el, "policy-tree").shadowRoot!;
    tree.querySelector<HTMLButtonElement>('[data-test="edit-department-name"]')!.click();
    await settle(el);
    const input = tree
      .querySelector('wt-input[name="departmentName"]')!
      .shadowRoot!.querySelector("input")!;
    input.value = "Dining and bar";
    input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    tree.querySelector<HTMLButtonElement>('[data-test="save-department-name"]')!.click();
    await vi.waitFor(() =>
      expect(updateDepartment).toHaveBeenCalledWith("d1", {
        name: "Dining and bar",
        tradingName: "Casa Delgado",
        defaultServiceMode: "table_tab",
      }),
    );
  });

  it("edits a department trading name in its table cell", async () => {
    const updateDepartment = vi.fn().mockResolvedValue(undefined);
    const el = await mount({
      load: vi.fn().mockResolvedValue(model),
      updateDepartment,
    } as unknown as VenueServiceApi);
    const tree = table(el, "policy-tree").shadowRoot!;
    tree.querySelector<HTMLButtonElement>('[data-test="edit-trading-name"]')!.click();
    await settle(el);
    const input = tree
      .querySelector('wt-input[name="tradingName"]')!
      .shadowRoot!.querySelector("input")!;
    input.value = "Casa Nueva";
    input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    tree.querySelector<HTMLButtonElement>('[data-test="save-trading-name"]')!.click();
    await vi.waitFor(() =>
      expect(updateDepartment).toHaveBeenCalledWith("d1", {
        name: "Restaurant and bar",
        tradingName: "Casa Nueva",
        defaultServiceMode: "table_tab",
      }),
    );
  });

  it("shows the sole department's own name with its zone beneath it", async () => {
    const el = await mount({
      load: vi.fn().mockResolvedValue({
        ...model,
        departments: [model.departments[0]],
        salePolicies: {
          departments: [
            {
              departmentId: "d1",
              paidWhen: "prepay",
              collectionNumber: "none",
              receiptPrintMode: "auto",
              printTradingName: true,
            },
          ],
          zones: [
            {
              zoneId: "z1",
              paidWhen: null,
              collectionNumber: null,
              receiptPrintMode: null,
              effective: {
                paidWhen: "prepay",
                collectionNumber: "none",
                receiptPrintMode: "auto",
                printTradingName: true,
              },
            },
          ],
        },
      }),
    } as unknown as VenueServiceApi);
    const tree = table(el, "policy-tree").shadowRoot!.querySelector('[role="treegrid"]')!;
    const rows = [...tree.querySelectorAll('tbody [role="row"]')];
    expect(rows).toHaveLength(3);
    expect(rows[0].getAttribute("aria-level")).toBe("1");
    expect(rows[0].textContent).toContain("Restaurant and bar");
    expect(rows[0].textContent).not.toContain("Every zone");
    expect(rows[0].textContent).toContain("Casa Delgado");
    expect(rows[1].getAttribute("aria-level")).toBe("2");
    expect(rows[1].textContent).toContain("Dining room");
    expect(rows[1].textContent).not.toContain("Casa Delgado");
    expect(rows[2].getAttribute("aria-level")).toBe("1");
    expect(rows[2].textContent).toContain("Deli counter");
    expect(rows[2].textContent).toContain("Not configured");
  });

  it("groups receipt, quick sale and every sale settings above their column labels", async () => {
    const el = await mount({
      load: vi.fn().mockResolvedValue(model),
    } as unknown as VenueServiceApi);
    const headings = [...table(el, "policy-tree").shadowRoot!.querySelectorAll("thead tr")];
    expect(headings).toHaveLength(2);
    expect(
      [...headings[0].querySelectorAll('th[scope="colgroup"]')].map((heading) => [
        heading.textContent?.trim(),
        heading.getAttribute("colspan"),
      ]),
    ).toEqual([
      ["On the receipt", "2"],
      ["Quick sales", "2"],
      ["Every sale", "1"],
    ]);
    expect(
      [...headings[1].querySelectorAll("th")].map((heading) => heading.textContent?.trim()),
    ).toEqual([
      "Department name",
      "Trading name",
      "Print it",
      "Paid",
      "Order number",
      "Receipt",
      "Actions",
    ]);
  });

  it("offers row actions in the policy tree and renames a zone in place", async () => {
    const el = await mount({
      load: vi.fn().mockResolvedValue(model),
    } as unknown as VenueServiceApi);
    const tree = table(el, "policy-tree").shadowRoot!;
    const rows = [...tree.querySelectorAll('tbody [role="row"]')];
    expect(rows).toHaveLength(4);
    expect(tree.querySelector('th[data-actions][data-pinned="end"]')).not.toBeNull();
    expect(rows[0].querySelector("wt-row-actions")!.textContent).toContain("Opening hours");
    expect(rows[1].querySelector("wt-row-actions")!.textContent).toContain("Disable");
    expect(rows[1].querySelector("wt-row-actions")!.textContent).not.toContain("Remove");
    expect(rows[3].textContent).toContain("Deli counter");
    expect(rows[3].querySelector("wt-row-actions")!.textContent).toContain("Edit");
    const rename = rows[1].querySelector<HTMLElement>('[data-test="rename-tree-zone-z1"]')!;
    rename
      .closest("wt-row-actions")!
      .shadowRoot!.querySelector<HTMLButtonElement>("button")!
      .click();
    rename.click();
    await settle(el);
    expect(tree.querySelector('wt-input[name="zoneName"]')).not.toBeNull();
  });

  it("moves a zone to another department through its row menu", async () => {
    const configureZone = vi.fn().mockResolvedValue(undefined);
    const el = await mount({
      load: vi.fn().mockResolvedValue(model),
      configureZone,
    } as unknown as VenueServiceApi);
    const tree = table(el, "policy-tree").shadowRoot!;
    const move = tree.querySelector<HTMLElement>('[data-test="move-tree-zone-z1"]')!;
    expect(move.textContent).toBe("Move to department");
    move.closest("wt-row-actions")!.shadowRoot!.querySelector<HTMLButtonElement>("button")!.click();
    move.click();
    await settle(el);
    const department = find(el, 'wt-combobox[name="zone-department-z1"]')! as HTMLElement & {
      value: string;
    };
    expect(department.value).toBe("d1");
    await chooseOption(department, "d2");
    await action(el, "save-editor");
    expect(configureZone).toHaveBeenCalledWith("z1", {
      departmentId: "d2",
      serviceMode: "prepay",
    });
  });

  it("shows an unconfigured floor zone in the tree and lets it join a department", async () => {
    const configureZone = vi.fn().mockResolvedValue(undefined);
    const el = await mount({
      load: vi.fn().mockResolvedValue(model),
      configureZone,
    } as unknown as VenueServiceApi);
    const tree = table(el, "policy-tree").shadowRoot!;
    const row = [...tree.querySelectorAll('tbody [role="row"]')].find((candidate) =>
      candidate.textContent?.includes("Deli counter"),
    );
    expect(row).toBeDefined();
    expect(row!.getAttribute("aria-level")).toBe("1");
    expect(row!.textContent).toContain("Not configured");
    await action(el, "configure-tree-zone-z2");
    const department = find(el, 'wt-combobox[name="zone-department-z2"]')! as HTMLElement & {
      value: string;
    };
    await chooseOption(department, "d2");
    await action(el, "save-editor");
    expect(configureZone).toHaveBeenCalledWith("z2", {
      departmentId: "d2",
      serviceMode: null,
    });
  });

  it("hides and shows a department's zones from an arrow named for the department", async () => {
    const el = await mount({
      load: vi.fn().mockResolvedValue(model),
    } as unknown as VenueServiceApi);
    const policyTree = table(el, "policy-tree") as HTMLElement & {
      updateComplete: Promise<unknown>;
    };
    const tree = policyTree.shadowRoot!;
    const department = () => tree.querySelector('[data-row-key="department-d1"]')!;
    const toggle = () => department().querySelector<HTMLButtonElement>('[part="tree-toggle"]');
    expect(toggle()).not.toBeNull();
    expect(toggle()!.getAttribute("aria-label")).toBe("Hide the zones in Restaurant and bar");
    expect(department().getAttribute("aria-expanded")).toBe("true");
    expect(tree.querySelector('[data-row-key="zone-z1"]')).not.toBeNull();

    toggle()!.click();
    await policyTree.updateComplete;
    expect(department().getAttribute("aria-expanded")).toBe("false");
    expect(toggle()!.getAttribute("aria-label")).toBe("Show the zones in Restaurant and bar");
    expect(tree.querySelector('[data-row-key="zone-z1"]')).toBeNull();
    expect(tree.querySelector('[data-row-key="zone-z2"]')).not.toBeNull();

    toggle()!.click();
    await policyTree.updateComplete;
    expect(department().getAttribute("aria-expanded")).toBe("true");
    expect(tree.querySelector('[data-row-key="zone-z1"]')).not.toBeNull();
  });

  it("names a department's arrow in Spanish", async () => {
    setLocale("es");
    const el = await mount({
      load: vi.fn().mockResolvedValue(model),
    } as unknown as VenueServiceApi);
    const policyTree = table(el, "policy-tree") as HTMLElement & {
      updateComplete: Promise<unknown>;
    };
    const toggle = () =>
      policyTree.shadowRoot!.querySelector<HTMLButtonElement>(
        '[data-row-key="department-d1"] [part="tree-toggle"]',
      );
    expect(toggle()?.getAttribute("aria-label")).toBe("Ocultar las zonas de Restaurant and bar");
    toggle()!.click();
    await policyTree.updateComplete;
    expect(toggle()?.getAttribute("aria-label")).toBe("Mostrar las zonas de Restaurant and bar");
  });

  it.each([
    ["desktop", 1280],
    ["phone", 390],
  ] as const)(
    "lines a department with no zones up with one that has an arrow (%s)",
    async (_name, width) => {
      const originalWidth = window.innerWidth;
      const originalHeight = window.innerHeight;
      try {
        await page.viewport(width, 844);
        const el = await mount({
          load: vi.fn().mockResolvedValue(model),
        } as unknown as VenueServiceApi);
        const tree = table(el, "policy-tree").shadowRoot!;
        const withZones = tree.querySelector('[data-row-key="department-d1"]')!;
        const withoutZones = tree.querySelector('[data-row-key="department-d2"]')!;
        expect(withZones.querySelector('[part="tree-toggle"]')).not.toBeNull();
        expect(withoutZones.querySelector('[part="tree-toggle"]')).toBeNull();
        expect(withoutZones.querySelector(".tree-spacer")).not.toBeNull();
        const nameLeft = (row: Element) =>
          row.querySelector('[data-test="edit-department-name"]')!.getBoundingClientRect().left;
        expect(nameLeft(withoutZones)).toBeCloseTo(nameLeft(withZones), 1);
      } finally {
        await page.viewport(originalWidth, originalHeight);
      }
    },
  );

  it("sets an unconfigured zone's note apart from its name, in the muted colour", async () => {
    const el = await mount({
      load: vi.fn().mockResolvedValue(model),
    } as unknown as VenueServiceApi);
    el.style.setProperty("--wt-color-text-muted", "rgb(7, 8, 9)");
    const row = table(el, "policy-tree").shadowRoot!.querySelector('[data-row-key="zone-z2"]')!;
    const name = row.querySelector('[data-test="edit-zone-name"]')!;
    const cell = row.querySelector('[role="gridcell"]')!;
    const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
    let note: Text | null = null;
    while (walker.nextNode()) {
      const text = walker.currentNode as Text;
      if (text.data.includes("Not configured")) note = text;
    }
    expect(note).not.toBeNull();
    const start = note!.data.indexOf("Not configured");
    const range = document.createRange();
    range.setStart(note!, start);
    range.setEnd(note!, start + "Not configured".length);
    const noteBox = range.getBoundingClientRect();
    const nameBox = name.getBoundingClientRect();
    expect(noteBox.top).toBeLessThan(nameBox.bottom);
    expect(noteBox.left - nameBox.right).toBeGreaterThan(0);
    expect(getComputedStyle(note!.parentElement!).color).toBe("rgb(7, 8, 9)");
  });

  it("does not label a zone of an inactive department as unconfigured", async () => {
    const el = await mount({
      load: vi.fn().mockResolvedValue({
        ...model,
        departments: [{ ...model.departments[0], active: false }, model.departments[1]],
      }),
    } as unknown as VenueServiceApi);
    const tree = table(el, "policy-tree").shadowRoot!;
    const rows = [...tree.querySelectorAll('tbody [role="row"]')];
    expect(rows.some((row) => row.textContent?.includes("Deli counter"))).toBe(true);
    const zone = rows.find((row) => row.textContent?.includes("Dining room"));
    expect(zone?.getAttribute("aria-level")).toBe("2");
    expect(zone?.textContent).not.toContain("Not configured");
  });

  it("retains a disabled department in the policy tree", async () => {
    const el = await mount({
      load: vi.fn().mockResolvedValue({
        ...model,
        departments: [{ ...model.departments[0], active: false }, model.departments[1]],
      }),
    } as unknown as VenueServiceApi);
    const rows = [...table(el, "policy-tree").shadowRoot!.querySelectorAll('tbody [role="row"]')];
    const department = rows.find((row) => row.textContent?.includes("Restaurant and bar"));
    expect(department?.textContent).toContain("Disabled");
    const name = department!.querySelector<HTMLElement>('[data-test="edit-department-name"]')!;
    const walker = document.createTreeWalker(department!, NodeFilter.SHOW_TEXT);
    let inactiveText: Text | null = null;
    while (walker.nextNode()) {
      if (walker.currentNode.textContent?.trim() === "Disabled") {
        inactiveText = walker.currentNode as Text;
        break;
      }
    }
    expect(inactiveText).not.toBeNull();
    const range = document.createRange();
    range.selectNodeContents(inactiveText!);
    expect(
      range.getBoundingClientRect().left - name.getBoundingClientRect().right,
    ).toBeGreaterThanOrEqual(8);
  });

  it("retains a disabled configured zone in the policy tree", async () => {
    const el = await mount({
      load: vi.fn().mockResolvedValue({
        ...model,
        floorZones: [{ ...model.floorZones[0]!, active: false }, model.floorZones[1]!],
      }),
    } as unknown as VenueServiceApi);
    const rows = [...table(el, "policy-tree").shadowRoot!.querySelectorAll('tbody [role="row"]')];
    const zone = rows.find((row) => row.textContent?.includes("Dining room"));
    expect(zone?.textContent).toContain("Disabled");
    expect(zone?.textContent).not.toContain("Inactive");
  });

  describe("enabling a disabled zone from its policy-tree row", () => {
    const disabled: VenueServiceView = {
      ...model,
      zones: [{ ...model.zones[0]!, active: false }],
      floorZones: [{ ...model.floorZones[0]!, active: false }, model.floorZones[1]!],
    };
    const enabled: VenueServiceView = {
      ...model,
      zones: [{ ...model.zones[0]!, active: true }],
      floorZones: [{ ...model.floorZones[0]!, active: true }, model.floorZones[1]!],
    };
    function zoneRow(el: VenueOperationsScreen) {
      return [...table(el, "policy-tree").shadowRoot!.querySelectorAll('tbody [role="row"]')].find(
        (row) => row.textContent?.includes("Dining room"),
      )!;
    }

    it("offers Enable, not Disable, on a disabled zone", async () => {
      const el = await mount({
        load: vi.fn().mockResolvedValue(disabled),
      } as unknown as VenueServiceApi);
      const row = zoneRow(el);
      expect(row.querySelector('[data-test="remove-tree-zone-z1"]')).toBeNull();
      expect(row.querySelector('[data-test="enable-tree-zone-z1"]')!.textContent!.trim()).toBe(
        "Enable",
      );
    });

    it("sends active: true for that zone, then shows it active with Disable again", async () => {
      const updateZone = vi.fn().mockResolvedValue(undefined);
      const load = vi.fn().mockResolvedValueOnce(disabled).mockResolvedValue(enabled);
      const el = await mount({ load, updateZone } as unknown as VenueServiceApi);
      await action(el, "enable-tree-zone-z1");
      expect(updateZone).toHaveBeenCalledExactlyOnceWith("z1", { active: true });
      await vi.waitFor(() => expect(zoneRow(el).textContent).not.toContain("Disabled"));
      const row = zoneRow(el);
      expect(row.getAttribute("data-row-key")).toBe("zone-z1");
      expect(row.querySelector('[data-test="enable-tree-zone-z1"]')).toBeNull();
      expect(row.querySelector('[data-test="remove-tree-zone-z1"]')!.textContent!.trim()).toBe(
        "Disable",
      );
      expect(pageAlert(el)).toBe("");
    });

    it("in Spanish, says Habilitar", async () => {
      setLocale("es");
      const el = await mount({
        load: vi.fn().mockResolvedValue(disabled),
      } as unknown as VenueServiceApi);
      expect(
        zoneRow(el).querySelector('[data-test="enable-tree-zone-z1"]')!.textContent!.trim(),
      ).toBe("Habilitar");
    });

    it("shows a refused Enable in the page alert and leaves the zone disabled", async () => {
      const updateZone = vi.fn().mockRejectedValue({ code: "connection.failed" });
      const load = vi.fn().mockResolvedValue(disabled);
      setLocale("es");
      const el = await mount({ load, updateZone } as unknown as VenueServiceApi);
      await action(el, "enable-tree-zone-z1");
      expect(updateZone).toHaveBeenCalledExactlyOnceWith("z1", { active: true });
      await vi.waitFor(() => expect(pageAlert(el)).toBe("No se pudo guardar el cambio."));
      expect(load).toHaveBeenCalledTimes(1);
      const row = zoneRow(el);
      expect(row.textContent).toContain("Deshabilitada");
      expect(row.querySelector('[data-test="enable-tree-zone-z1"]')).not.toBeNull();
    });

    it.each([
      [
        "en",
        "That zone needs an active department. Enable its department or assign it to an active one first",
      ],
      [
        "es",
        "Esa zona necesita un departamento habilitado. Habilita su departamento o asígnala primero a uno habilitado",
      ],
    ] as const)("explains a department refusal from Enable in %s", async (locale, message) => {
      setLocale(locale);
      const updateZone = vi
        .fn()
        .mockRejectedValue({ code: "zone.department_inactive", params: { zoneId: "z1" } });
      const el = await mount({
        load: vi.fn().mockResolvedValue(disabled),
        updateZone,
      } as unknown as VenueServiceApi);
      await action(el, "enable-tree-zone-z1");
      await vi.waitFor(() => expect(pageAlert(el)).toBe(message));
      expect(zoneRow(el).querySelector('[data-test="enable-tree-zone-z1"]')).not.toBeNull();
    });

    it("draws a gap between a disabled zone's name and its Disabled word", async () => {
      const el = await mount({
        load: vi.fn().mockResolvedValue(disabled),
      } as unknown as VenueServiceApi);
      const row = zoneRow(el);
      const name = row.querySelector('[data-test="edit-zone-name"]')!.getBoundingClientRect();
      const label = row.querySelector("[part~=inactive-zone-label]")!;
      expect(label.textContent!.trim()).toBe("Disabled");
      expect(label.getBoundingClientRect().left - name.right).toBeGreaterThan(2);
    });

    it("withholds Enable until a disabled zone belongs to an active department", async () => {
      const updateZone = vi.fn().mockResolvedValue(undefined);
      const el = await mount({
        load: vi.fn().mockResolvedValue({
          ...model,
          floorZones: [model.floorZones[0]!, { ...model.floorZones[1]!, active: false }],
        }),
        updateZone,
      } as unknown as VenueServiceApi);
      const row = [
        ...table(el, "policy-tree").shadowRoot!.querySelectorAll('tbody [role="row"]'),
      ].find((candidate) => candidate.textContent?.includes("Deli counter"))!;
      expect(row.getAttribute("aria-level")).toBe("1");
      expect(row.querySelector('[data-test="remove-tree-zone-z2"]')).toBeNull();
      expect(row.querySelector('[data-test="enable-tree-zone-z2"]')).toBeNull();
      expect(updateZone).not.toHaveBeenCalled();
    });

    it("offers neither Enable nor Disable on a disabled zone of a disabled department", async () => {
      const el = await mount({
        load: vi.fn().mockResolvedValue({
          ...disabled,
          departments: [{ ...model.departments[0]!, active: false }, model.departments[1]!],
        }),
      } as unknown as VenueServiceApi);
      const row = zoneRow(el);
      expect(row.getAttribute("aria-level")).toBe("2");
      expect(row.textContent).toContain("Disabled");
      expect(row.querySelector('[data-test="enable-tree-zone-z1"]')).toBeNull();
      expect(row.querySelector('[data-test="remove-tree-zone-z1"]')).toBeNull();
      expect(row.querySelector('[data-test="rename-tree-zone-z1"]')).not.toBeNull();
    });
  });

  describe("enabling a disabled department", () => {
    const disabled: VenueServiceView = {
      ...model,
      departments: [model.departments[0]!, { ...model.departments[1]!, active: false }],
    };
    function departmentRow(el: VenueOperationsScreen) {
      return [...table(el, "policy-tree").shadowRoot!.querySelectorAll('tbody [role="row"]')].find(
        (row) => row.getAttribute("data-row-key") === "department-d2",
      )!;
    }

    it("offers Enable, not Disable, on a disabled department's policy-tree row", async () => {
      const el = await mount({
        load: vi.fn().mockResolvedValue(disabled),
      } as unknown as VenueServiceApi);
      const row = departmentRow(el);
      expect(row.querySelector('[data-test="remove-tree-department-d2"]')).toBeNull();
      expect(
        row.querySelector('[data-test="enable-tree-department-d2"]')!.textContent!.trim(),
      ).toBe("Enable");
      const active = [
        ...table(el, "policy-tree").shadowRoot!.querySelectorAll('tbody [role="row"]'),
      ].find((candidate) => candidate.getAttribute("data-row-key") === "department-d1")!;
      expect(active.querySelector('[data-test="enable-tree-department-d1"]')).toBeNull();
      expect(
        active.querySelector('[data-test="remove-tree-department-d1"]')!.textContent!.trim(),
      ).toBe("Disable");
    });

    it("sends active: true from the policy tree, then shows the department active with Disable again", async () => {
      const updateDepartment = vi.fn().mockResolvedValue(undefined);
      const load = vi.fn().mockResolvedValueOnce(disabled).mockResolvedValue(model);
      const el = await mount({ load, updateDepartment } as unknown as VenueServiceApi);
      await action(el, "enable-tree-department-d2");
      expect(updateDepartment).toHaveBeenCalledExactlyOnceWith("d2", { active: true });
      await vi.waitFor(() =>
        expect(departmentRow(el).querySelector("[part~=inactive-department-label]")).toBeNull(),
      );
      const row = departmentRow(el);
      expect(row.querySelector('[data-test="enable-tree-department-d2"]')).toBeNull();
      expect(
        row.querySelector('[data-test="remove-tree-department-d2"]')!.textContent!.trim(),
      ).toBe("Disable");
      expect(pageAlert(el)).toBe("");
    });

    it("offers Enable, not Disable department, on the departments tab, and enabling makes it Active", async () => {
      const updateDepartment = vi.fn().mockResolvedValue(undefined);
      const load = vi.fn().mockResolvedValueOnce(disabled).mockResolvedValue(model);
      const el = await mount({ load, updateDepartment } as unknown as VenueServiceApi);
      await selectTab(el, "departments");
      expect(column(el, "departments", 3)).toEqual(["Active", "Disabled"]);
      expect(find(el, '[data-test="deactivate-department-d2"]')).toBeNull();
      expect(find(el, '[data-test="enable-department-d2"]')!.textContent!.trim()).toBe("Enable");
      expect(find(el, '[data-test="enable-department-d1"]')).toBeNull();
      expect(find(el, '[data-test="deactivate-department-d1"]')!.textContent!.trim()).toBe(
        "Disable department",
      );
      await action(el, "enable-department-d2");
      expect(updateDepartment).toHaveBeenCalledExactlyOnceWith("d2", { active: true });
      await vi.waitFor(() => expect(column(el, "departments", 3)).toEqual(["Active", "Active"]));
      expect(find(el, '[data-test="enable-department-d2"]')).toBeNull();
      expect(find(el, '[data-test="deactivate-department-d2"]')).not.toBeNull();
    });

    it("in Spanish, says Habilitar on both", async () => {
      setLocale("es");
      const el = await mount({
        load: vi.fn().mockResolvedValue(disabled),
      } as unknown as VenueServiceApi);
      expect(
        departmentRow(el)
          .querySelector('[data-test="enable-tree-department-d2"]')!
          .textContent!.trim(),
      ).toBe("Habilitar");
      await selectTab(el, "departments");
      expect(find(el, '[data-test="enable-department-d2"]')!.textContent!.trim()).toBe("Habilitar");
    });

    it("shows a refused Enable in the page alert and leaves the department disabled", async () => {
      const updateDepartment = vi.fn().mockRejectedValue({ code: "connection.failed" });
      const load = vi.fn().mockResolvedValue(disabled);
      setLocale("es");
      const el = await mount({ load, updateDepartment } as unknown as VenueServiceApi);
      await action(el, "enable-tree-department-d2");
      expect(updateDepartment).toHaveBeenCalledExactlyOnceWith("d2", { active: true });
      await vi.waitFor(() => expect(pageAlert(el)).toBe("No se pudo guardar el cambio."));
      expect(load).toHaveBeenCalledTimes(1);
      const row = departmentRow(el);
      expect(row.querySelector("[part~=inactive-department-label]")!.textContent!.trim()).toBe(
        "Deshabilitado",
      );
      expect(row.querySelector('[data-test="enable-tree-department-d2"]')).not.toBeNull();
    });
  });

  it("in Spanish, says Deshabilitar and words a disabled zone and department by their gender", async () => {
    setLocale("es");
    const el = await mount({
      load: vi.fn().mockResolvedValue({
        ...model,
        departments: [{ ...model.departments[0], active: false }, model.departments[1]],
        floorZones: [{ ...model.floorZones[0]!, active: false }, model.floorZones[1]!],
      }),
      zoneRemovalImpact: vi.fn().mockResolvedValue({
        zones: [{ id: "z2", name: "Deli counter", activeTableCount: 0 }],
      }),
    } as unknown as VenueServiceApi);
    const rows = [...table(el, "policy-tree").shadowRoot!.querySelectorAll('tbody [role="row"]')];
    const department = rows.find((row) => row.textContent?.includes("Restaurant and bar"))!;
    const zone = rows.find((row) => row.textContent?.includes("Dining room"))!;
    const activeZone = rows.find((row) => row.textContent?.includes("Deli counter"))!;
    expect(department.querySelector("[part~=inactive-department-label]")!.textContent!.trim()).toBe(
      "Deshabilitado",
    );
    expect(zone.textContent).toContain("Deshabilitada");
    expect(zone.querySelector('[data-test="remove-tree-zone-z1"]')).toBeNull();
    expect(activeZone.querySelector('[data-test="remove-tree-zone-z2"]')!.textContent!.trim()).toBe(
      "Deshabilitar",
    );
    await action(el, "remove-tree-zone-z2");
    expect(modal(el)?.getAttribute("heading")).toBe("¿Deshabilitar Deli counter?");
    await selectTab(el, "departments");
    expect(column(el, "departments", 3)).toEqual(["Deshabilitado", "Activo"]);
  });

  it("names a sole active department and offers no move to an inactive one", async () => {
    const el = await mount({
      load: vi.fn().mockResolvedValue({
        ...model,
        departments: [model.departments[0], { ...model.departments[1], active: false }],
      }),
    } as unknown as VenueServiceApi);
    const tree = table(el, "policy-tree").shadowRoot!;
    const rows = [...tree.querySelectorAll('tbody [role="row"]')];
    const active = rows.find((row) => row.textContent?.includes("Dining room"));
    expect(rows[0].textContent).toContain("Restaurant and bar");
    expect(rows[0].textContent).not.toContain("Every zone");
    expect(active).toBeDefined();
    expect(active!.querySelector('[data-test="move-tree-zone-z1"]')).toBeNull();
  });

  it("confirms disabling a zone from its policy-tree row", async () => {
    const deactivateZone = vi.fn().mockResolvedValue(undefined);
    const el = await mount({
      load: vi.fn().mockResolvedValue(model),
      deactivateZone,
      departmentRemovalImpact: vi.fn().mockResolvedValue({
        zones: [{ id: "z1", name: "Dining room", activeTableCount: 0 }],
      }),
    } as unknown as VenueServiceApi);
    const tree = table(el, "policy-tree").shadowRoot!;
    const remove = tree.querySelector<HTMLElement>('[data-test="remove-tree-zone-z1"]')!;
    remove
      .closest("wt-row-actions")!
      .shadowRoot!.querySelector<HTMLButtonElement>("button")!
      .click();
    expect(remove.textContent!.trim()).toBe("Disable");
    remove.click();
    await settle(el);
    expect(modal(el)?.getAttribute("heading")).toBe("Disable Dining room?");
    expect(deactivateZone).not.toHaveBeenCalled();
    await action(el, "save-editor");
    expect(deactivateZone).toHaveBeenCalledWith("z1");
  });

  it("shows active tables before disabling an unconfigured zone", async () => {
    const deactivateZone = vi.fn().mockResolvedValue(undefined);
    const zoneRemovalImpact = vi.fn().mockResolvedValue({
      zones: [{ id: "z2", name: "Deli counter", activeTableCount: 2 }],
    });
    const el = await mount({
      load: vi.fn().mockResolvedValue(model),
      deactivateZone,
      zoneRemovalImpact,
    } as unknown as VenueServiceApi);
    await action(el, "remove-tree-zone-z2");
    expect(zoneRemovalImpact).toHaveBeenCalledWith("z2");
    expect(modal(el)?.textContent).toContain("Deli counter");
    expect(modal(el)?.textContent).toContain("2 active tables");
    expect(deactivateZone).not.toHaveBeenCalled();
    await action(el, "save-editor");
    expect(deactivateZone).toHaveBeenCalledWith("z2");
  });

  it("keeps disabling a zone available after a rejected request", async () => {
    const deactivateZone = vi.fn().mockRejectedValue({ code: "zone.not_found" });
    const el = await mount({
      load: vi.fn().mockResolvedValue(model),
      deactivateZone,
      departmentRemovalImpact: vi.fn().mockResolvedValue({
        zones: [{ id: "z1", name: "Dining room", activeTableCount: 0 }],
      }),
    } as unknown as VenueServiceApi);
    const tree = table(el, "policy-tree").shadowRoot!;
    const remove = tree.querySelector<HTMLElement>('[data-test="remove-tree-zone-z1"]')!;
    remove
      .closest("wt-row-actions")!
      .shadowRoot!.querySelector<HTMLButtonElement>("button")!
      .click();
    remove.click();
    await settle(el);
    await action(el, "save-editor");
    await vi.waitFor(() => expect(deactivateZone).toHaveBeenCalledWith("z1"));
    expect(modal(el)).not.toBeNull();
    expect(await bottom(el)).toBe("The change could not be saved.");
  });

  it("names the zone and its active tables before disabling it", async () => {
    const el = await mount({
      load: vi.fn().mockResolvedValue(model),
      departmentRemovalImpact: vi.fn().mockResolvedValue({
        zones: [{ id: "z1", name: "Dining room", activeTableCount: 2 }],
      }),
    } as unknown as VenueServiceApi);
    const tree = table(el, "policy-tree").shadowRoot!;
    const remove = tree.querySelector<HTMLElement>('[data-test="remove-tree-zone-z1"]')!;
    remove
      .closest("wt-row-actions")!
      .shadowRoot!.querySelector<HTMLButtonElement>("button")!
      .click();
    remove.click();
    await settle(el);
    expect(modal(el)?.textContent).toMatch(/Dining room:\s*2 active tables/);
  });

  it("opens the Hours page focused on the chosen policy-tree department", async () => {
    history.replaceState(null, "", "/manage/venue-operations");
    const el = await mount({
      load: vi.fn().mockResolvedValue(model),
    } as unknown as VenueServiceApi);
    const tree = table(el, "policy-tree").shadowRoot!;
    const hours = tree.querySelector<HTMLElement>('[data-test="hours-tree-department-d2"]')!;
    expect(hours.textContent!.trim()).toBe("Opening hours");
    const visits: string[] = [];
    const record = () => visits.push(location.pathname);
    window.addEventListener("popstate", record);
    const pushed = vi.spyOn(history, "pushState");
    let pushedUrls: string[];
    try {
      hours
        .closest("wt-row-actions")!
        .shadowRoot!.querySelector<HTMLButtonElement>("button")!
        .click();
      hours.click();
      await settle(el);
    } finally {
      window.removeEventListener("popstate", record);
      pushedUrls = pushed.mock.calls.map((call) => String(call[2]));
      pushed.mockRestore();
    }
    expect(location.pathname).toBe("/manage/hours/department/d2");
    // Chromium stops counting history.length at 50, so the entry is counted at pushState.
    expect(pushedUrls).toEqual(["/manage/hours/department/d2"]);
    expect(visits).toEqual(["/manage/hours/department/d2"]);
    expect(modal(el)).toBeNull();
  });

  it("shows the effective quick-sale and receipt policy beside each department and zone", async () => {
    const el = await mount({
      load: vi.fn().mockResolvedValue({
        ...model,
        salePolicies: {
          departments: [
            {
              departmentId: "d1",
              paidWhen: "prepay",
              collectionNumber: "none",
              receiptPrintMode: "auto",
              printTradingName: true,
            },
            {
              departmentId: "d2",
              paidWhen: "ticket_then_pay",
              collectionNumber: "numbered",
              receiptPrintMode: "on_request",
              printTradingName: false,
            },
          ],
          zones: [
            {
              zoneId: "z1",
              paidWhen: "ticket_then_pay",
              collectionNumber: null,
              receiptPrintMode: "never",
              effective: {
                paidWhen: "ticket_then_pay",
                collectionNumber: "none",
                receiptPrintMode: "never",
                printTradingName: true,
              },
            },
          ],
        },
      }),
    } as unknown as VenueServiceApi);
    const rows = [...table(el, "policy-tree").shadowRoot!.querySelectorAll('tbody [role="row"]')];
    expect(rows).toHaveLength(4);
    expect(rows[0].textContent).toContain("Pay before preparation");
    expect(rows[0].textContent).toContain("None");
    expect(rows[0].textContent).toContain("Always");
    expect(rows[1].textContent).toContain("Pay on collection");
    expect(rows[1].textContent).toContain("None");
    expect(rows[1].textContent).toContain("Never");
    expect(rows[2].textContent).toContain("Pay on collection");
    expect(rows[2].textContent).toContain("Numbered");
    expect(rows[2].textContent).toContain("On request");
    expect(rows[3].textContent).toContain("Not configured");
    expect(rows[3].querySelector('[data-test="edit-paid"]')).toBeNull();
  });

  it("mutes an inherited zone value while leaving its own override prominent", async () => {
    const el = await mount({
      load: vi.fn().mockResolvedValue({
        ...model,
        salePolicies: {
          departments: [
            {
              departmentId: "d1",
              paidWhen: "prepay",
              collectionNumber: "numbered",
              receiptPrintMode: "auto",
              printTradingName: true,
            },
          ],
          zones: [
            {
              zoneId: "z1",
              paidWhen: "ticket_then_pay",
              collectionNumber: null,
              receiptPrintMode: null,
              effective: {
                paidWhen: "ticket_then_pay",
                collectionNumber: "numbered",
                receiptPrintMode: "auto",
                printTradingName: true,
              },
            },
          ],
        },
      }),
    } as unknown as VenueServiceApi);
    const zoneRow = table(el, "policy-tree").shadowRoot!.querySelectorAll('tbody [role="row"]')[1]!;
    const paid = zoneRow.querySelector<HTMLElement>('[data-test="edit-paid"]')!;
    const collection = zoneRow.querySelector<HTMLElement>('[data-test="edit-collection"]')!;
    const receipt = zoneRow.querySelector<HTMLElement>('[data-test="edit-receipt"]')!;
    expect(collection.textContent).toContain("Numbered");
    expect(receipt.textContent).toContain("Always");
    expect(getComputedStyle(collection).color).toBe(getComputedStyle(receipt).color);
    expect(getComputedStyle(collection).color).not.toBe(getComputedStyle(paid).color);
  });

  it("changes paid timing on a department and lets a zone inherit it again", async () => {
    let departmentPaidWhen: "prepay" | "ticket_then_pay" = "prepay";
    let zonePaidWhen: "prepay" | "ticket_then_pay" | null = "ticket_then_pay";
    const setDepartmentSalePolicyField = vi.fn(async (_id, _field, value) => {
      departmentPaidWhen = value;
    });
    const setZoneSalePolicyOverride = vi.fn(async (_id, _field, value) => {
      zonePaidWhen = value;
    });
    const load = vi.fn(async () => ({
      ...model,
      departments: [model.departments[0]],
      salePolicies: {
        departments: [
          {
            departmentId: "d1",
            paidWhen: departmentPaidWhen,
            collectionNumber: "none" as const,
            receiptPrintMode: "auto" as const,
            printTradingName: true,
          },
        ],
        zones: [
          {
            zoneId: "z1",
            paidWhen: zonePaidWhen,
            collectionNumber: null,
            receiptPrintMode: null,
            effective: {
              paidWhen: zonePaidWhen ?? departmentPaidWhen,
              collectionNumber: "none" as const,
              receiptPrintMode: "auto" as const,
              printTradingName: true,
            },
          },
        ],
      },
    }));
    const el = await mount({
      load,
      setDepartmentSalePolicyField,
      setZoneSalePolicyOverride,
    } as unknown as VenueServiceApi);
    const paidControls = () => [
      ...table(el, "policy-tree").shadowRoot!.querySelectorAll<HTMLElement>(
        'wt-combobox[name="paidWhen"]',
      ),
    ];
    const paidButtons = () => [
      ...table(el, "policy-tree").shadowRoot!.querySelectorAll<HTMLButtonElement>(
        '[data-test="edit-paid"]',
      ),
    ];
    expect(paidButtons()).toHaveLength(2);
    paidButtons()[0].click();
    await settle(el);
    expect(paidControls()).toHaveLength(1);
    expect(
      (paidControls()[0] as HTMLElement & { options: { value: string }[] }).options.map(
        (option) => option.value,
      ),
    ).toEqual(["prepay", "ticket_then_pay"]);
    await chooseOption(paidControls()[0], "ticket_then_pay");
    await vi.waitFor(() =>
      expect(setDepartmentSalePolicyField).toHaveBeenCalledWith(
        "d1",
        "paidWhen",
        "ticket_then_pay",
      ),
    );
    await vi.waitFor(() => expect(paidButtons()).toHaveLength(2));
    paidButtons()[1].click();
    await settle(el);
    expect(
      (paidControls()[0] as HTMLElement & { options: { value: string }[] }).options[0].value,
    ).toBe("");
    expect(
      (paidControls()[0] as HTMLElement & { options: { label: string }[] }).options[0].label,
    ).toContain("Pay on collection");
    await chooseOption(paidControls()[0], "");
    await vi.waitFor(() =>
      expect(setZoneSalePolicyOverride).toHaveBeenCalledWith("z1", "paidWhen", null),
    );
    await vi.waitFor(() => expect(paidButtons()).toHaveLength(2));
    expect(paidButtons()[1].textContent).toContain("Pay on collection");
  });

  it("keeps a refused paid-timing choice ready to retry", async () => {
    const save = vi.fn().mockRejectedValue(new Error("offline"));
    const el = await mount({
      load: vi.fn().mockResolvedValue({
        ...model,
        departments: [model.departments[0]],
        salePolicies: {
          departments: [
            {
              departmentId: "d1",
              paidWhen: "prepay",
              collectionNumber: "none",
              receiptPrintMode: "auto",
              printTradingName: true,
            },
          ],
          zones: [],
        },
      }),
      setDepartmentSalePolicyField: save,
    } as unknown as VenueServiceApi);
    table(el, "policy-tree")
      .shadowRoot!.querySelector<HTMLButtonElement>('[data-test="edit-paid"]')!
      .click();
    await settle(el);
    const control = () =>
      table(el, "policy-tree").shadowRoot!.querySelector<HTMLElement & { value: string }>(
        'wt-combobox[name="paidWhen"]',
      )!;
    await chooseOption(control(), "ticket_then_pay");
    await vi.waitFor(() => expect(save).toHaveBeenCalledWith("d1", "paidWhen", "ticket_then_pay"));
    await vi.waitFor(() => expect(pageAlert(el)).toContain("could not be saved"));
    expect(control().value).toBe("ticket_then_pay");
    await chooseOption(control(), "prepay");
    await settle(el);
    const departmentRow = table(el, "policy-tree").shadowRoot!.querySelector('tbody [role="row"]')!;
    expect(departmentRow.querySelector('wt-combobox[name="paidWhen"]')).toBeNull();
    expect(departmentRow.querySelector('[data-test="edit-paid"]')?.textContent).toContain(
      "Pay before preparation",
    );
    expect(save).toHaveBeenCalledTimes(1);
  });

  /** A department's paid choice, open in its dropdown and showing pay before preparation. */
  async function openPaidChoice(save: ReturnType<typeof vi.fn>, load = vi.fn()) {
    load.mockResolvedValue({
      ...model,
      departments: [model.departments[0]],
      salePolicies: {
        departments: [
          {
            departmentId: "d1",
            paidWhen: "prepay",
            collectionNumber: "none",
            receiptPrintMode: "auto",
            printTradingName: true,
          },
        ],
        zones: [],
      },
    });
    const el = await mount({
      load,
      setDepartmentSalePolicyField: save,
    } as unknown as VenueServiceApi);
    table(el, "policy-tree")
      .shadowRoot!.querySelector<HTMLButtonElement>('[data-test="edit-paid"]')!
      .click();
    await settle(el);
    const control = table(el, "policy-tree").shadowRoot!.querySelector<
      HTMLElement & { value: string }
    >('wt-combobox[name="paidWhen"]')!;
    expect(control.value).toBe("prepay");
    return { el, control };
  }

  // Fails if choosing the paid choice a department already has saves it again.
  it("saves nothing when the paid choice already shown is chosen again", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const load = vi.fn();
    const { el, control } = await openPaidChoice(save, load);
    expect(await clickChosenRow(control)).toBe(1);
    await settle(el);
    expect(save).not.toHaveBeenCalled();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("keeps a paid choice's change inside the screen", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { control } = await openPaidChoice(save);
    expect(await changesHeardOutside(() => chooseOption(control, "ticket_then_pay"))).toBe(0);
    await vi.waitFor(() => expect(save).toHaveBeenCalledWith("d1", "paidWhen", "ticket_then_pay"));
  });

  it("does not present a missing paid policy as pay before preparation", async () => {
    const el = await mount({
      load: vi.fn().mockResolvedValue(model),
    } as unknown as VenueServiceApi);
    expect(
      table(el, "policy-tree").shadowRoot!.querySelector('[data-test="edit-paid"]'),
    ).toBeNull();
  });

  it.each(
    (["en", "es"] as const).flatMap((locale) =>
      (["light", "dark"] as const).flatMap((theme) =>
        [390, 1280].map((width) => ({ locale, theme, width })),
      ),
    ),
  )(
    "explains quick-sale-only numbering on the $locale $theme $width department and zone controls",
    async ({ locale, theme, width }) => {
      const originalWidth = window.innerWidth;
      const originalHeight = window.innerHeight;
      await page.viewport(width, 844);
      try {
        setLocale(locale);
        const explanation =
          locale === "en"
            ? "Quick sales only: orders on a table tab are not numbered."
            : "Solo ventas rápidas: los pedidos de una cuenta de mesa no se numeran.";
        const label = locale === "en" ? "About order numbers" : "Acerca de los números de pedido";
        const el = await mount({
          load: vi.fn().mockResolvedValue({
            ...model,
            departments: [model.departments[0]],
            salePolicies: {
              departments: [
                {
                  departmentId: "d1",
                  paidWhen: "prepay",
                  collectionNumber: "numbered",
                  receiptPrintMode: "auto",
                  printTradingName: true,
                },
              ],
              zones: [
                {
                  zoneId: "z1",
                  paidWhen: null,
                  collectionNumber: null,
                  receiptPrintMode: null,
                  effective: {
                    paidWhen: "prepay",
                    collectionNumber: "numbered",
                    receiptPrintMode: "auto",
                    printTradingName: true,
                  },
                },
              ],
            },
          }),
        } as unknown as VenueServiceApi);
        const host = el.parentElement!;
        host.setAttribute("data-theme", theme);
        host.style.background = "var(--wt-color-bg)";
        const root = table(el, "policy-tree").shadowRoot!;
        const cells = [
          ...root.querySelectorAll<HTMLButtonElement>('[data-test="edit-collection"]'),
        ];
        expect(cells).toHaveLength(2);
        for (const cell of cells) {
          const help = cell.parentElement!.querySelector("wt-help-tooltip");
          expect(help).not.toBeNull();
          await userEvent.click(help!.shadowRoot!.querySelector("button")!);
          expect(
            help!.shadowRoot!.querySelector('[role="tooltip"]')!.matches(":popover-open"),
          ).toBe(true);
          expect(help!.textContent?.trim()).toBe(explanation);
          expect(help!.shadowRoot!.querySelector("button")!.getAttribute("aria-label")).toBe(label);
          await userEvent.keyboard("{Escape}");
          cell.click();
          await settle(el);
          const box = root.querySelector('wt-combobox[name="collectionNumber"]')!;
          const editorHelp = box.querySelector('wt-help-tooltip[slot="help"]');
          expect(editorHelp).not.toBeNull();
          await userEvent.click(editorHelp!.shadowRoot!.querySelector("button")!);
          expect(
            editorHelp!.shadowRoot!.querySelector('[role="tooltip"]')!.matches(":popover-open"),
          ).toBe(true);
          expect(editorHelp!.textContent?.trim()).toBe(explanation);
          const popup = editorHelp!.shadowRoot!.querySelector<HTMLElement>('[role="tooltip"]')!;
          expect(popup.getBoundingClientRect().left).toBeGreaterThanOrEqual(0);
          expect(popup.getBoundingClientRect().right).toBeLessThanOrEqual(width);
          await userEvent.keyboard("{Escape}");
        }
      } finally {
        await page.viewport(originalWidth, originalHeight);
      }
    },
  );

  it("changes a department collection number and lets a zone inherit it", async () => {
    let departmentCollection: "none" | "numbered" = "none";
    let zoneCollection: "none" | "numbered" | null = "numbered";
    const setDepartmentSalePolicyField = vi.fn(async (_id, _field, value) => {
      departmentCollection = value;
    });
    const setZoneSalePolicyOverride = vi.fn(async (_id, _field, value) => {
      zoneCollection = value;
    });
    const load = vi.fn(async () => ({
      ...model,
      departments: [model.departments[0]],
      salePolicies: {
        departments: [
          {
            departmentId: "d1",
            paidWhen: "prepay" as const,
            collectionNumber: departmentCollection,
            receiptPrintMode: "auto" as const,
            printTradingName: true,
          },
        ],
        zones: [
          {
            zoneId: "z1",
            paidWhen: null,
            collectionNumber: zoneCollection,
            receiptPrintMode: null,
            effective: {
              paidWhen: "prepay" as const,
              collectionNumber: zoneCollection ?? departmentCollection,
              receiptPrintMode: "auto" as const,
              printTradingName: true,
            },
          },
        ],
      },
    }));
    const el = await mount({
      load,
      setDepartmentSalePolicyField,
      setZoneSalePolicyOverride,
    } as unknown as VenueServiceApi);
    const tree = () => table(el, "policy-tree").shadowRoot!;
    const buttons = () => [
      ...tree().querySelectorAll<HTMLButtonElement>('[data-test="edit-collection"]'),
    ];
    const control = () =>
      tree().querySelector<HTMLElement & { value: string; options: { value: string }[] }>(
        'wt-combobox[name="collectionNumber"]',
      )!;
    expect(buttons()).toHaveLength(2);
    buttons()[0].click();
    await settle(el);
    expect(control().options.map((option) => option.value)).toEqual(["none", "numbered"]);
    await chooseOption(control(), "numbered");
    await vi.waitFor(() =>
      expect(setDepartmentSalePolicyField).toHaveBeenCalledWith(
        "d1",
        "collectionNumber",
        "numbered",
      ),
    );
    await vi.waitFor(() => expect(buttons()).toHaveLength(2));
    buttons()[1].click();
    await settle(el);
    expect(control().options[0].value).toBe("");
    await chooseOption(control(), "");
    await vi.waitFor(() =>
      expect(setZoneSalePolicyOverride).toHaveBeenCalledWith("z1", "collectionNumber", null),
    );
    await vi.waitFor(() => expect(buttons()[1].textContent).toContain("Numbered"));
  });

  it("changes a department receipt choice and lets a zone inherit it", async () => {
    let departmentMode: "auto" | "on_request" = "auto";
    let zoneMode: "never" | null = "never";
    const setDepartmentSalePolicyField = vi.fn(async (_id, _field, value) => {
      departmentMode = value;
    });
    const setZoneSalePolicyOverride = vi.fn(async (_id, _field, value) => {
      zoneMode = value;
    });
    const load = vi.fn(async () => ({
      ...model,
      departments: [model.departments[0]],
      salePolicies: {
        departments: [
          {
            departmentId: "d1",
            paidWhen: "prepay" as const,
            collectionNumber: "none" as const,
            receiptPrintMode: departmentMode,
            printTradingName: true,
          },
        ],
        zones: [
          {
            zoneId: "z1",
            paidWhen: null,
            collectionNumber: null,
            receiptPrintMode: zoneMode,
            effective: {
              paidWhen: "prepay" as const,
              collectionNumber: "none" as const,
              receiptPrintMode: zoneMode ?? departmentMode,
              printTradingName: true,
            },
          },
        ],
      },
    }));
    const el = await mount({
      load,
      setDepartmentSalePolicyField,
      setZoneSalePolicyOverride,
    } as unknown as VenueServiceApi);
    const tree = () => table(el, "policy-tree").shadowRoot!;
    const buttons = () => [
      ...tree().querySelectorAll<HTMLButtonElement>('[data-test="edit-receipt"]'),
    ];
    const control = () =>
      tree().querySelector<HTMLElement & { options: { value: string; label: string }[] }>(
        'wt-combobox[name="receiptPrintMode"]',
      )!;
    expect(buttons()).toHaveLength(2);
    buttons()[0].click();
    await settle(el);
    expect(control().options.map((option) => option.value)).toEqual([
      "auto",
      "on_request",
      "never",
    ]);
    await chooseOption(control(), "on_request");
    await vi.waitFor(() =>
      expect(setDepartmentSalePolicyField).toHaveBeenCalledWith(
        "d1",
        "receiptPrintMode",
        "on_request",
      ),
    );
    await vi.waitFor(() => expect(buttons()).toHaveLength(2));
    buttons()[1].click();
    await settle(el);
    expect(control().options[0].value).toBe("");
    expect(control().options[0].label).toContain("On request");
    await chooseOption(control(), "");
    await vi.waitFor(() =>
      expect(setZoneSalePolicyOverride).toHaveBeenCalledWith("z1", "receiptPrintMode", null),
    );
    await vi.waitFor(() => expect(buttons()[1].textContent).toContain("On request"));
  });

  describe.each([
    {
      field: "paidWhen",
      button: "edit-paid",
      stored: "prepay",
      changed: "ticket_then_pay",
      label: "Pay before preparation",
    },
    {
      field: "collectionNumber",
      button: "edit-collection",
      stored: "none",
      changed: "numbered",
      label: "None",
    },
    {
      field: "receiptPrintMode",
      button: "edit-receipt",
      stored: "auto",
      changed: "never",
      label: "Always",
    },
  ] as const)("$field inline recovery", ({ field, button, stored, changed, label }) => {
    const policies = {
      departments: [
        {
          departmentId: "d1",
          paidWhen: "prepay" as const,
          collectionNumber: "none" as const,
          receiptPrintMode: "auto" as const,
          printTradingName: true,
        },
      ],
      zones: [
        {
          zoneId: "z1",
          paidWhen: null,
          collectionNumber: null,
          receiptPrintMode: null,
          effective: {
            paidWhen: "prepay" as const,
            collectionNumber: "none" as const,
            receiptPrintMode: "auto" as const,
            printTradingName: true,
          },
        },
      ],
    };

    it.each(["department", "zone"] as const)(
      "returns a refused %s edit to the saved choice without another write",
      async (kind) => {
        const departmentSave = vi.fn().mockRejectedValue(new Error("offline"));
        const zoneSave = vi.fn().mockRejectedValue(new Error("offline"));
        const el = await mount({
          load: vi.fn().mockResolvedValue({
            ...model,
            departments: [model.departments[0]],
            salePolicies: policies,
          }),
          setDepartmentSalePolicyField: departmentSave,
          setZoneSalePolicyOverride: zoneSave,
        } as unknown as VenueServiceApi);
        const tree = () => table(el, "policy-tree").shadowRoot!;
        const buttons = () => [
          ...tree().querySelectorAll<HTMLButtonElement>(`[data-test="${button}"]`),
        ];
        const index = kind === "department" ? 0 : 1;
        buttons()[index].click();
        await settle(el);
        const control = () =>
          tree().querySelector<HTMLElement & { value: string }>(`wt-combobox[name="${field}"]`)!;
        await chooseOption(control(), changed);
        const save = kind === "department" ? departmentSave : zoneSave;
        await vi.waitFor(() =>
          expect(save).toHaveBeenCalledWith(kind === "department" ? "d1" : "z1", field, changed),
        );
        await vi.waitFor(() => expect(pageAlert(el)).toContain("could not be saved"));
        expect(control().value).toBe(changed);
        await chooseOption(control(), kind === "department" ? stored : "");
        await vi.waitFor(() => expect(buttons()).toHaveLength(2));
        expect(buttons()[index].textContent).toContain(label);
        expect(tree().querySelector(`wt-combobox[name="${field}"]`)).toBeNull();
        expect(save).toHaveBeenCalledTimes(1);
        expect(kind === "department" ? zoneSave : departmentSave).not.toHaveBeenCalled();
        expect(pageAlert(el)).toBe("");
      },
    );

    it("shows an explicit zone override after saving", async () => {
      let saved = false;
      const save = vi.fn(async () => {
        saved = true;
      });
      const el = await mount({
        load: vi.fn(async () => ({
          ...model,
          departments: [model.departments[0]],
          salePolicies: {
            ...policies,
            zones: [
              {
                ...policies.zones[0],
                [field]: saved ? changed : null,
                effective: { ...policies.zones[0].effective, [field]: saved ? changed : stored },
              },
            ],
          },
        })),
        setZoneSalePolicyOverride: save,
      } as unknown as VenueServiceApi);
      const tree = () => table(el, "policy-tree").shadowRoot!;
      const buttons = () => [
        ...tree().querySelectorAll<HTMLButtonElement>(`[data-test="${button}"]`),
      ];
      buttons()[1].click();
      await settle(el);
      await chooseOption(
        tree().querySelector<HTMLElement>(`wt-combobox[name="${field}"]`)!,
        changed,
      );
      await vi.waitFor(() => expect(save).toHaveBeenCalledWith("z1", field, changed));
      await vi.waitFor(() => expect(buttons()).toHaveLength(2));
      await vi.waitFor(() =>
        expect(buttons()[1].getAttribute("part")).not.toContain("inherited-value"),
      );
      buttons()[1].click();
      await settle(el);
      expect(
        tree().querySelector<HTMLElement & { value: string }>(`wt-combobox[name="${field}"]`)!
          .value,
      ).toBe(changed);
    });
  });

  it.each([
    {
      name: "zoneName",
      edit: "edit-zone-name",
      save: "save-zone-name",
      cancel: "cancel-zone-name",
      old: "Dining room",
    },
    {
      name: "departmentName",
      edit: "edit-department-name",
      save: "save-department-name",
      cancel: "cancel-department-name",
      old: "Restaurant and bar",
    },
    {
      name: "tradingName",
      edit: "edit-trading-name",
      save: "save-trading-name",
      cancel: "cancel-trading-name",
      old: "Casa Delgado",
    },
  ])(
    "refuses a blank $name and restores its displayed name on Cancel",
    async ({ name, edit, save, cancel, old }) => {
      const updateDepartment = vi.fn();
      const updateZone = vi.fn();
      const el = await mount({
        load: vi.fn().mockResolvedValue(model),
        updateDepartment,
        updateZone,
      } as unknown as VenueServiceApi);
      await action(el, edit);
      const control = find(el, `wt-input[name="${name}"]`)!;
      control.dispatchEvent(
        new CustomEvent("wt-change", { detail: { value: "   " }, bubbles: true, composed: true }),
      );
      await settle(el);
      await action(el, save);
      expect(control.getAttribute("error")).toContain("required");
      expect(updateDepartment).not.toHaveBeenCalled();
      expect(updateZone).not.toHaveBeenCalled();
      await action(el, cancel);
      expect(find(el, `wt-input[name="${name}"]`)).toBeNull();
      expect(find(el, `[data-test="${edit}"]`)!.textContent).toContain(old);
    },
  );

  it("switches receipt trading names on a department without offering the switch on a zone", async () => {
    let printTradingName = false;
    const save = vi.fn(async (departmentId: string, field: string, value: boolean) => {
      expect([departmentId, field, value]).toEqual(["d1", "printTradingName", true]);
      printTradingName = value;
    });
    const load = vi.fn(async () => ({
      ...model,
      departments: [model.departments[0]],
      salePolicies: {
        departments: [
          {
            departmentId: "d1",
            paidWhen: "prepay" as const,
            collectionNumber: "none" as const,
            receiptPrintMode: "auto" as const,
            printTradingName,
          },
        ],
        zones: [
          {
            zoneId: "z1",
            paidWhen: null,
            collectionNumber: null,
            receiptPrintMode: null,
            effective: {
              paidWhen: "prepay" as const,
              collectionNumber: "none" as const,
              receiptPrintMode: "auto" as const,
              printTradingName,
            },
          },
        ],
      },
    }));
    const el = await mount({
      load,
      setDepartmentSalePolicyField: save,
    } as unknown as VenueServiceApi);
    const rows = [...table(el, "policy-tree").shadowRoot!.querySelectorAll('tbody [role="row"]')];
    const control = rows[0].querySelector<HTMLElement>('wt-switch[name="printTradingName"]')!;
    expect(control).not.toBeNull();
    expect(rows[1].querySelector('wt-switch[name="printTradingName"]')).toBeNull();
    expect(control.hasAttribute("checked")).toBe(false);
    control.shadowRoot!.querySelector<HTMLInputElement>("input")!.click();
    await vi.waitFor(() => expect(save).toHaveBeenCalledOnce());
    await vi.waitFor(() =>
      expect(
        table(el, "policy-tree")
          .shadowRoot!.querySelector('wt-switch[name="printTradingName"]')
          ?.hasAttribute("checked"),
      ).toBe(true),
    );
  });

  it("keeps a refused receipt trading-name choice visible", async () => {
    let printTradingName = false;
    const save = vi.fn(async (_departmentId: string, _field: string, value: boolean) => {
      if (save.mock.calls.length === 1) throw new Error("offline");
      printTradingName = value;
    });
    const load = vi.fn(async () => ({
      ...model,
      departments: [model.departments[0]],
      salePolicies: {
        departments: [
          {
            departmentId: "d1",
            paidWhen: "prepay" as const,
            collectionNumber: "none" as const,
            receiptPrintMode: "auto" as const,
            printTradingName,
          },
        ],
        zones: [],
      },
    }));
    const el = await mount({
      load,
      setDepartmentSalePolicyField: save,
    } as unknown as VenueServiceApi);
    const switchInput = () =>
      table(el, "policy-tree")
        .shadowRoot!.querySelector<HTMLElement>('wt-switch[name="printTradingName"]')!
        .shadowRoot!.querySelector<HTMLInputElement>("input")!;
    switchInput().click();
    await vi.waitFor(() => expect(save).toHaveBeenCalledOnce());
    await vi.waitFor(() =>
      expect(find(el, '[data-test="page-alert"]')?.textContent).toContain("could not be saved"),
    );
    expect(switchInput().checked).toBe(true);
    expect(printTradingName).toBe(false);
  });

  it("keeps the tree's Add outside the tabs", async () => {
    const el = await mount({
      load: vi.fn().mockResolvedValue(model),
    } as unknown as VenueServiceApi);
    const tabs = el.shadowRoot!.querySelector("wt-tabs")!;
    await selectTab(el, "departments");
    expect(tabs.querySelector('[slot="actions"] [data-test="new-department"]')).toBeNull();
    expect(
      el.shadowRoot!.querySelector(
        '[data-test="policy-tree-actions"] [data-test="new-department"]',
      ),
    ).not.toBeNull();
    expect(find(el, '[data-test="new-department"]')!.checkVisibility()).toBe(true);
    expect(tabs.querySelector('[slot="departments"] [data-test="new-department"]')).toBeNull();
  });

  it("puts Add department under its empty table's sentence, opening its editor", async () => {
    const el = await mount({
      load: vi.fn().mockResolvedValue({ ...model, departments: [] }),
    } as unknown as VenueServiceApi);
    await selectTab(el, "departments");
    const department = table(el, "departments").querySelector<HTMLElement>(
      ":scope > [slot=empty-action]",
    )!;
    expect(department.assignedSlot).not.toBeNull();
    expect(department.textContent!.trim()).toBe("Add department");
    department.click();
    await settle(el);
    expect(modal(el)!.getAttribute("heading")).toBe("Add department");
  });

  const emptySentences = {
    en: {
      departments: "No departments yet.",
      zones: "No service zones yet.",
    },
    es: {
      departments: "Todavía no hay departamentos.",
      zones: "Todavía no hay zonas de servicio.",
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
        floorZones: [],
      }),
    } as unknown as VenueServiceApi);
    await selectTab(empty, "departments");
    expect(emptySentence(empty, "departments")).toBe(expected.departments);
    await selectTab(empty, "zones");
    expect(emptySentence(empty, "zones")).toBe(expected.zones);
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

  it("shows departments, trading names and zones, with no menu default", async () => {
    const el = await mount({
      load: vi.fn().mockResolvedValue(model),
    } as unknown as VenueServiceApi);
    expect(el.shadowRoot!.querySelector('[data-test="readiness-issue-0"]')!.textContent).toContain(
      "No default prep station is active.",
    );
    await selectTab(el, "departments");
    expect(tableText(el, "departments")).toContain("Restaurant and bar");
    expect(tableText(el, "departments")).toContain("Casa Delgado Deli");
    await selectTab(el, "zones");
    expect(tableText(el, "zones")).toContain("Dining room");
    expect(tableText(el, "zones")).toContain("Deli counter");
    expect(tableText(el, "zones")).not.toContain("Casa Delgado");
    await action(el, "edit-zone-z1");
    expect(field(el, "zone-mode-z1").value).toBe("prepay");
  });

  it("opens receipt preview for the selected department", async () => {
    const el = await mount({
      load: vi.fn().mockResolvedValue(model),
    } as unknown as VenueServiceApi);
    const link = table(el, "policy-tree").shadowRoot!.querySelector<HTMLAnchorElement>(
      'a[href="/manage/venue-settings/view/receipts?departmentId=d2"]',
    );
    expect(link?.textContent?.trim()).toBe("Preview");
  });

  it("separates the trading name edit and receipt preview links", async () => {
    const el = await mount({
      load: vi.fn().mockResolvedValue(model),
    } as unknown as VenueServiceApi);
    const root = table(el, "policy-tree").shadowRoot!;
    const edit = root.querySelector<HTMLElement>('[data-test="edit-trading-name"]')!;
    const preview = root.querySelector<HTMLElement>(
      'a[href="/manage/venue-settings/view/receipts?departmentId=d1"]',
    )!;

    expect(
      preview.getBoundingClientRect().left - edit.getBoundingClientRect().right,
    ).toBeGreaterThanOrEqual(8);
  });

  it("offers each active department’s receipt preview from the unified tree", async () => {
    const el = await mount({
      load: vi.fn().mockResolvedValue(model),
    } as unknown as VenueServiceApi);
    const tree = table(el, "policy-tree");
    const links = [...tree.shadowRoot!.querySelectorAll<HTMLAnchorElement>("a[href]")];
    expect(links.map((link) => [link.textContent?.trim(), link.getAttribute("href")])).toEqual([
      ["Preview", "/manage/venue-settings/view/receipts?departmentId=d1"],
      ["Preview", "/manage/venue-settings/view/receipts?departmentId=d2"],
    ]);
    expect(
      el.shadowRoot!.querySelectorAll('a[href^="/manage/venue-settings/view/receipts?"]'),
    ).toHaveLength(0);
  });

  it("disables a department that has no active zones", async () => {
    const api = {
      load: vi.fn().mockResolvedValue(model),
      departmentRemovalImpact: vi.fn().mockResolvedValue({ zones: [] }),
      deactivateDepartment: vi.fn().mockResolvedValue(undefined),
    } as unknown as VenueServiceApi;
    const el = await mount(api);
    await selectTab(el, "departments");
    expect(find(el, '[data-test="deactivate-department-d2"]')!.textContent!.trim()).toBe(
      "Disable department",
    );
    await action(el, "deactivate-department-d2");
    expect(modal(el)?.getAttribute("heading")).toMatch(/^Disable .+\?$/);
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
      departmentRemovalImpact: vi.fn().mockResolvedValue({ zones: [] }),
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

  it("offers only current service styles for departments and zones", async () => {
    const api = { load: vi.fn().mockResolvedValue(model) } as unknown as VenueServiceApi;
    const el = await mount(api);
    await selectTab(el, "departments");
    await action(el, "new-department");
    const department = field(el, "department-mode") as unknown as { options: { value: string }[] };
    expect(department.options.map((option) => option.value)).toEqual([
      "table_tab",
      "prepay",
      "ticket_then_pay",
    ]);
    await action(el, "cancel-editor");
    await selectTab(el, "zones");
    await action(el, "edit-zone-z1");
    const zone = field(el, "zone-mode-z1") as unknown as typeof department;
    expect(zone.options.map((option) => option.value)).toEqual([
      "",
      "table_tab",
      "prepay",
      "ticket_then_pay",
    ]);
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
    field(el, "department-mode").value = "ticket_then_pay";
    await action(el, "save-editor");
    expect(api.createDepartment).toHaveBeenCalledWith({
      name: "Events",
      tradingName: "Casa Delgado Events",
      defaultServiceMode: "ticket_then_pay",
    });
  });

  // A real click lets the screen re-render between its own click handler and the menu's: the
  // save it starts disables every action, which the menu must not read as a disabled click.
  it("closes the row menu when a zone action saves straight away", async () => {
    const api = {
      load: vi.fn().mockResolvedValue({
        ...model,
        zones: [{ ...model.zones[0]!, active: false }],
        floorZones: [{ ...model.floorZones[0]!, active: false }, model.floorZones[1]!],
      }),
      // Still in flight, as a real request is while the menu decides whether to close.
      updateZone: vi.fn(() => new Promise(() => {})),
    } as unknown as VenueServiceApi;
    const el = await mount(api);
    const button = find(el, '[data-test="enable-tree-zone-z1"]')!;
    const menu = button.closest("wt-row-actions")!;
    const popup = menu.shadowRoot!.querySelector<HTMLElement>("[popover]")!;
    await userEvent.click(menu.shadowRoot!.querySelector("button")!);
    expect(popup.matches(":popover-open")).toBe(true);
    await userEvent.click(button);
    await settle(el);
    expect(vi.mocked(api.updateZone).mock.calls.length).toBe(1);
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
    expect(text).toContain("No default prep station is active.");
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
it("shows two tabs and a read-only departments table, and creates departments in a cancellable modal", async () => {
  const api = {
    load: vi.fn().mockResolvedValue(model),
    createDepartment: vi.fn(),
  } as unknown as VenueServiceApi;
  const el = await mount(api);
  expect(
    el.shadowRoot!.querySelector("wt-tabs")!.shadowRoot!.querySelectorAll('[role="tab"]'),
  ).toHaveLength(2);
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
  expect(tabs.map((tab) => tab.getAttribute("data-key"))).toEqual(["departments", "zones"]);
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
  field(el, "zone-mode-z2").value = "ticket_then_pay";
  await action(el, "save-editor");
  expect(api.configureZone).toHaveBeenLastCalledWith("z2", {
    departmentId: "d1",
    serviceMode: "ticket_then_pay",
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

it("names the zones and active tables before removing a department", async () => {
  const api = {
    load: vi.fn().mockResolvedValue(model),
    departmentRemovalImpact: vi.fn().mockResolvedValue({
      zones: [{ id: "z1", name: "Dining room", activeTableCount: 2 }],
    }),
    deactivateDepartment: vi.fn().mockResolvedValue(undefined),
  } as unknown as VenueServiceApi;
  const el = await mount(api);
  await selectTab(el, "departments");
  await action(el, "deactivate-department-d1");
  expect(await bottom(el)).toBe("");
  expect(modal(el)?.textContent).toContain("Dining room");
  expect(modal(el)?.textContent).toContain("2 active tables");
  expect(api.deactivateDepartment).not.toHaveBeenCalled();
  await action(el, "save-editor");
  expect(api.deactivateDepartment).toHaveBeenCalledWith("d1");
});

it.each([
  [
    { code: "zone.table_in_use", params: { tableName: "Window 4" } },
    "Table Window 4 has an open tab. Close it before disabling this department.",
  ],
  [{ code: "department.last_active" }, "You cannot disable the last active department."],
])("keeps the disable modal open with a named refusal", async (refusal, expected) => {
  const api = {
    load: vi.fn().mockResolvedValue(model),
    departmentRemovalImpact: vi.fn().mockResolvedValue({ zones: [] }),
    deactivateDepartment: vi.fn().mockRejectedValue(refusal),
  } as unknown as VenueServiceApi;
  const el = await mount(api);
  await selectTab(el, "departments");
  await action(el, "deactivate-department-d1");
  await action(el, "save-editor");
  expect(await bottom(el)).toContain(expected);
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

  it("marks disabled departments", async () => {
    const el = await mount({
      load: vi.fn().mockResolvedValue({
        ...model,
        departments: [model.departments[0]!, { ...model.departments[1]!, active: false }],
      }),
    } as unknown as VenueServiceApi);
    await selectTab(el, "departments");
    expect(column(el, "departments", 3)).toEqual(["Active", "Disabled"]);
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
    ["zones", "zones", "waitron.venue.zones.table", ["department", "mode"]],
  ] as const)(
    "the %s tab's %s list offers every column but the first and the actions, and remembers a hidden one",
    async (tab, name, viewKey, keys) => {
      const el = await mount({
        load: vi.fn().mockResolvedValue(model),
      } as unknown as VenueServiceApi);
      await selectTab(el, tab);
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
    await selectTab(el, "zones");
    expect(chooser(el, "zones")).toBe("Personalizar columnas");
  });

  it("words a column that is always shown, and the last one shown, in Spanish", async () => {
    setLocale("es");
    const el = await mount({
      load: vi.fn().mockResolvedValue(model),
    } as unknown as VenueServiceApi);
    await selectTab(el, "departments");
    await selectTab(el, "zones");
    for (const name of ["departments", "zones"]) {
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
      tab: "zones",
      open: ["edit-zone-z1"],
      method: "configureZone",
      code: "department.not_found",
      control: "zone-department-z1",
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
      configureZone: vi.fn().mockRejectedValue(invalidRequest("zoneId")),
    } as unknown as VenueServiceApi);
    await selectTab(el, "zones");
    await action(el, "edit-zone-z1");
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
      zones: [{ ...model.zones[0]!, active: false }],
      floorZones: [{ ...model.floorZones[0]!, active: false }, model.floorZones[1]!],
    }),
    updateZone: vi.fn().mockRejectedValue(new Error("offline")),
  } as unknown as VenueServiceApi;
  const el = await mount(api);
  await action(el, "enable-tree-zone-z1");
  expect(api.updateZone).toHaveBeenCalledTimes(1);
  expect(modal(el)).toBeNull();
  expect(pageAlert(el)).toBe("The change could not be saved.");
  expect(el.shadowRoot!.querySelector('[data-test="page-alert"]')!.getAttribute("role")).toBe(
    "alert",
  );
});

it("shows the general save error when a write is refused without a reason", async () => {
  const api = {
    load: vi.fn().mockResolvedValue(model),
    departmentRemovalImpact: vi.fn().mockResolvedValue({ zones: [] }),
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
      departmentRemovalImpact: vi.fn().mockResolvedValue({ zones: [] }),
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

it("returns focus to a retained row or the tree's Add action when that row is gone", async () => {
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
  load.mockResolvedValue(updated);
  liveData.invalidate([{ type: "departments", id: "d2" }]);
  await vi.waitFor(() => expect(column(el, "departments", 0)).toEqual(["Restaurant and bar"]));
  await action(el, "cancel-editor");
  expect(el.shadowRoot!.activeElement).toBe(
    el.shadowRoot!.querySelector('[data-test="policy-tree-actions"] [data-test="new-department"]'),
  );
});

it("returns focus to the tree's Add action when an edited department disappears", async () => {
  const liveData = new LiveData();
  const load = vi.fn().mockResolvedValue(structuredClone(model));
  const el = await mount({ load, liveData } as unknown as VenueServiceApi);
  await action(el, "edit-tree-department-d2");
  const updated = structuredClone(model);
  updated.departments = [updated.departments[0]!];
  load.mockResolvedValue(updated);
  liveData.invalidate([{ type: "departments", id: "d2" }]);
  await vi.waitFor(() =>
    expect(table(el, "policy-tree").shadowRoot!.textContent).not.toContain("Casa Delgado Deli"),
  );
  expect(find(el, '[data-test="edit-tree-department-d2"]')).toBeNull();
  await action(el, "cancel-editor");
  await vi.waitFor(() =>
    expect(el.shadowRoot!.activeElement).toBe(
      el.shadowRoot!.querySelector(
        '[data-test="policy-tree-actions"] [data-test="new-department"]',
      ),
    ),
  );
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
    };
  }
  const tables: {
    table: string;
    add: string;
    empty: Partial<VenueServiceView>;
    write: "createDepartment";
    show: (el: VenueOperationsScreen) => Promise<void>;
    fill: (el: VenueOperationsScreen) => void;
  }[] = [
    {
      table: "departments",
      add: "new-department",
      empty: { departments: [] },
      write: "createDepartment",
      show: (el: VenueOperationsScreen) => selectTab(el, "departments"),
      fill: (el: VenueOperationsScreen) => {
        field(el, "department-name").value = "Events";
        field(el, "trading-name").value = "Casa Events";
      },
    },
  ];
  function top(el: VenueOperationsScreen, add: string) {
    const button = el.shadowRoot!.querySelector<HTMLElement>(
      `[data-test="policy-tree-actions"] [data-test="${add}"]`,
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
      ["ticket_then_pay", "Prepare then pay"],
    ]);
    await type(el, "department-name", "Events");
    await type(el, "trading-name", "Casa Delgado Events");
    await chooseOption(mode, "ticket_then_pay");
    await action(el, "save-editor");
    expect(api.createDepartment).toHaveBeenCalledWith({
      name: "Events",
      tradingName: "Casa Delgado Events",
      defaultServiceMode: "ticket_then_pay",
    });
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

  // Fails if the Spanish catalogue loses the dropdowns' search wording.
  it("words the dropdowns' search in Spanish", async () => {
    setLocale("es");
    const el = await mount({
      load: vi.fn().mockResolvedValue(model),
    } as unknown as VenueServiceApi);
    await selectTab(el, "zones");
    await action(el, "edit-zone-z1");
    const department = dropdown(el.shadowRoot!, "zone-department-z1");
    expect([department.searchPlaceholder, department.noResultsLabel]).toEqual([
      "Buscar",
      "Sin resultados",
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
    floorZones: [
      { id: "z1", name: "Comedor principal junto a la terraza del jardín" },
      model.floorZones[1]!,
    ],
  };
  const tables: { name: string; tab: string; open?: string; rows: number }[] = [
    { name: "departments", tab: "departments", rows: phoneModel.departments.length },
    { name: "zones", tab: "zones", rows: phoneModel.floorZones.length },
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
        const list = table(el, name);
        list.scrollIntoView({ block: "center" });
        expectRowMenusOnScreen(list, rows);
      } finally {
        await page.viewport(width, height);
      }
    },
  );
});

it.each([
  ["en", "Search", "No results"],
  ["es", "Buscar", "Sin resultados"],
])(
  "localizes the receipt picker's native search and empty result in %s",
  async (locale, search, empty) => {
    setLocale(locale);
    const el = await mount({
      load: vi.fn().mockResolvedValue({
        ...model,
        salePolicies: {
          departments: [
            {
              departmentId: "d1",
              paidWhen: "prepay",
              collectionNumber: "none",
              receiptPrintMode: "on_request",
              printTradingName: true,
            },
          ],
          zones: [],
        },
      }),
    } as unknown as VenueServiceApi);
    find(el, '[data-test="edit-receipt"]')!.click();
    await settle(el);
    const box = find(el, 'wt-combobox[name="receiptPrintMode"]')! as HTMLElement & {
      updateComplete: Promise<boolean>;
    };
    box.shadowRoot!.querySelector<HTMLButtonElement>("button")!.click();
    await box.updateComplete;
    const input = box.shadowRoot!.querySelector<HTMLInputElement>("input")!;
    expect(input.placeholder).toBe(search);
    input.value = "no receipt option has this name";
    input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    await box.updateComplete;
    expect(box.shadowRoot!.textContent).toContain(empty);
  },
);

it("Opening hours uses a distinct history position and Keep preserves the Operations entry", async () => {
  history.replaceState(null, "", "/manage/before-operations");
  let dirty = false;
  let asks = 0;
  const guard = new NavigationGuard(window, {
    isDirty: () => dirty,
    request: async () => {
      asks++;
      return "kept";
    },
  });
  onTestFinished(() => guard.dispose());
  await guard.write("/manage/venue-operations");
  const el = await mount({ load: vi.fn().mockResolvedValue(model) } as unknown as VenueServiceApi);
  const hours = table(el, "policy-tree").shadowRoot!.querySelector<HTMLElement>(
    '[data-test="hours-tree-department-d2"]',
  )!;
  hours.closest("wt-row-actions")!.shadowRoot!.querySelector<HTMLButtonElement>("button")!.click();
  hours.click();
  await expect.poll(() => location.pathname).toBe("/manage/hours/department/d2");
  dirty = true;
  history.back();
  await expect.poll(() => asks).toBe(1);
  expect(location.pathname).toBe("/manage/hours/department/d2");
  await expect.poll(() => guard.write(guard.href)).toBe("proceeded");
  dirty = false;
  history.back();
  await expect.poll(() => location.pathname).toBe("/manage/venue-operations");
  history.forward();
  await expect.poll(() => location.pathname).toBe("/manage/hours/department/d2");
});

describe("reserved venue names", () => {
  it.each(["department", "zone"] as const)(
    "offers Enable beside a disabled %s name refusal without creating another row",
    async (kind) => {
      const snapshot = structuredClone(model);
      snapshot.departments[1]!.active = false;
      snapshot.floorZones[0]!.active = false;
      snapshot.zones[0]!.active = false;
      const id = kind === "department" ? "d2" : "z1";
      const name = kind === "department" ? "Deli" : "Dining room";
      const create = vi
        .fn()
        .mockRejectedValue({ code: `${kind}.name_disabled`, params: { name, [`${kind}Id`]: id } });
      const update = vi.fn().mockImplementation(async () => {
        if (kind === "department") snapshot.departments[1]!.active = true;
        else {
          snapshot.floorZones[0]!.active = true;
          snapshot.zones[0]!.active = true;
        }
      });
      const el = await mount({
        load: vi.fn().mockImplementation(async () => structuredClone(snapshot)),
        [kind === "department" ? "createDepartment" : "createZone"]: create,
        [kind === "department" ? "updateDepartment" : "updateZone"]: update,
      } as unknown as VenueServiceApi);
      await action(el, kind === "department" ? "new-department" : "new-zone");
      const control = kind === "department" ? "department-name" : "new-zone-name";
      await type(el, control, name);
      if (kind === "department") await type(el, "trading-name", "Shop");
      else await chooseOption(field(el, "new-zone-department"), "Restaurant and bar");
      await action(el, "save-editor");
      expect(fieldError(el, control)).toBe(
        `A disabled ${kind} already has this name. Enable it instead.`,
      );
      expect(saveDisabled(el)).toBe(false);
      const enable = find(el, '[data-test="enable-name-clash"]');
      expect(enable).not.toBeNull();
      expect(enable!.textContent!.trim()).toBe(`Enable ${name}`);
      await action(el, "enable-name-clash");
      await expect.poll(() => modal(el)).toBeNull();
      expect(update).toHaveBeenCalledWith(id, { active: true });
      expect(create).toHaveBeenCalledTimes(1);
      expect(tableText(el, "policy-tree")).toContain(name);
    },
  );

  it.each(["department", "zone"] as const)(
    "explains an active %s name refusal without offering Enable",
    async (kind) => {
      const el = await mount({
        load: vi.fn().mockResolvedValue(model),
        [kind === "department" ? "createDepartment" : "createZone"]: vi
          .fn()
          .mockRejectedValue({ code: `${kind}.name_taken`, params: { name: "Reserved" } }),
      } as unknown as VenueServiceApi);
      await action(el, kind === "department" ? "new-department" : "new-zone");
      const control = kind === "department" ? "department-name" : "new-zone-name";
      await type(el, control, "Reserved");
      if (kind === "department") await type(el, "trading-name", "Shop");
      else await chooseOption(field(el, "new-zone-department"), "Restaurant and bar");
      await action(el, "save-editor");
      expect(fieldError(el, control)).toBe(`A ${kind} with this name already exists.`);
      expect(find(el, '[data-test="enable-name-clash"]')).toBeNull();
      expect(saveDisabled(el)).toBe(false);
    },
  );
});

describe.each(["en", "es"] as const)("reserved name renames (%s)", (locale) => {
  it.each(["department", "zone"] as const)(
    "puts a disabled %s clash beneath the inline name and enables the existing row",
    async (kind) => {
      setLocale(locale);
      await page.viewport(390, 900);
      onTestFinished(() => page.viewport(1280, 900));
      const name = kind === "department" ? "Deli" : "Deli counter";
      const id = kind === "department" ? "d2" : "z2";
      const update = vi
        .fn()
        .mockImplementation(async (_id: string, patch: { active?: boolean }) => {
          if (!patch.active)
            throw { code: `${kind}.name_disabled`, params: { name, [`${kind}Id`]: id } };
        });
      const el = await mount({
        load: vi.fn().mockResolvedValue(model),
        [kind === "department" ? "updateDepartment" : "updateZone"]: update,
      } as unknown as VenueServiceApi);
      await action(el, `edit-${kind}-name`);
      const control = find(el, `wt-input[name="${kind}Name"]`)!;
      const native = control.shadowRoot!.querySelector("input")!;
      native.value = name;
      native.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
      await settle(el);
      await action(el, `save-${kind}-name`);
      const expected =
        locale === "en"
          ? `A disabled ${kind} already has this name. Enable it instead.`
          : kind === "department"
            ? "Un departamento deshabilitado ya tiene este nombre. Habilítalo en su lugar."
            : "Una zona deshabilitada ya tiene este nombre. Habilítala en su lugar.";
      expect(control.getAttribute("error")).toBe(expected);
      expect(pageAlert(el)).toBe("");
      const enable = find(el, '[data-test="enable-name-clash"]');
      expect(enable).not.toBeNull();
      expect(enable!.getBoundingClientRect().right).toBeLessThanOrEqual(window.innerWidth);
      expect(enable!.getBoundingClientRect().left).toBeGreaterThanOrEqual(0);
      expect(enable!.textContent!.trim()).toBe(
        `${locale === "en" ? "Enable" : "Habilitar"} ${name}`,
      );
      await action(el, "enable-name-clash");
      expect(update).toHaveBeenLastCalledWith(id, { active: true });
      expect(find(el, '[data-test="enable-name-clash"]')).toBeNull();
      expect(find(el, `wt-input[name="${kind}Name"]`)!.getAttribute("error")).toBe(
        locale === "en"
          ? `A ${kind} with this name already exists.`
          : `Ya existe ${kind === "department" ? "un departamento" : "una zona"} con este nombre.`,
      );
      expect(
        find(el, `wt-input[name="${kind}Name"]`)!.shadowRoot!.querySelector("input")!.value,
      ).toBe(name);
    },
  );
});

it("clears a disabled-name Enable offer when the modal name changes and retains it when Enable fails", async () => {
  const el = await mount({
    load: vi.fn().mockResolvedValue(model),
    createDepartment: vi.fn().mockRejectedValue({
      code: "department.name_disabled",
      params: { name: "Deli", departmentId: "d2" },
    }),
    updateDepartment: vi.fn().mockRejectedValue(new Error("offline")),
  } as unknown as VenueServiceApi);
  await action(el, "new-department");
  await type(el, "department-name", "Deli");
  await type(el, "trading-name", "Shop");
  await action(el, "save-editor");
  await action(el, "enable-name-clash");
  expect(modal(el)).not.toBeNull();
  expect(await bottom(el)).toContain("The change could not be saved.");
  expect(find(el, '[data-test="enable-name-clash"]')).not.toBeNull();
  expect(saveDisabled(el)).toBe(false);
  await type(el, "department-name", "New Deli");
  expect(find(el, '[data-test="enable-name-clash"]')).toBeNull();
  expect(fieldError(el, "department-name")).toBeUndefined();
});

it("does not attach an earlier inline name refusal to newer text", async () => {
  let refuse!: (reason: unknown) => void;
  const pending = new Promise<void>((_resolve, reject) => {
    refuse = reject;
  });
  const el = await mount({
    load: vi.fn().mockResolvedValue(model),
    updateZone: vi.fn().mockReturnValue(pending),
  } as unknown as VenueServiceApi);
  await action(el, "edit-zone-name");
  const control = find(el, 'wt-input[name="zoneName"]')!;
  const native = control.shadowRoot!.querySelector("input")!;
  const change = async (value: string) => {
    native.value = value;
    native.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    await settle(el);
  };
  await change("Deli counter");
  await action(el, "save-zone-name");
  await change("New terrace");
  refuse({ code: "zone.name_disabled", params: { name: "Deli counter", zoneId: "z2" } });
  await settle(el);
  expect(control.getAttribute("error")).toBe("");
  expect(find(el, '[data-test="enable-name-clash"]')).toBeNull();
  expect(native.value).toBe("New terrace");
});

it.each(["success", "refusal"] as const)(
  "does not attach a pending inline Enable %s to newer text",
  async (outcome) => {
    let resolve!: () => void;
    let reject!: (reason: unknown) => void;
    const pending = new Promise<void>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    const update = vi.fn().mockImplementation(async (_id: string, patch: { active?: boolean }) => {
      if (patch.active) return pending;
      throw { code: "zone.name_disabled", params: { name: "Deli counter", zoneId: "z2" } };
    });
    const el = await mount({
      load: vi.fn().mockResolvedValue(model),
      updateZone: update,
    } as unknown as VenueServiceApi);
    await action(el, "edit-zone-name");
    const control = find(el, 'wt-input[name="zoneName"]')!;
    const change = async (value: string) => {
      const native = control.shadowRoot!.querySelector("input")!;
      native.value = value;
      native.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
      await settle(el);
    };
    await change("Deli counter");
    await action(el, "save-zone-name");
    await action(el, "enable-name-clash");
    await change("New terrace");
    expect(control.getAttribute("error")).toBe("");
    if (outcome === "success") resolve();
    else reject({ code: "zone.department_inactive", params: { zoneId: "z2" } });
    await settle(el);
    expect(control.getAttribute("error")).toBe("");
    expect(find(el, '[data-test="enable-name-clash"]')).toBeNull();
  },
);

it("explains a blocked zone Enable beside its reserved name and removes the unusable offer", async () => {
  const el = await mount({
    load: vi.fn().mockResolvedValue(model),
    createZone: vi
      .fn()
      .mockRejectedValue({
        code: "zone.name_disabled",
        params: { name: "Dining room", zoneId: "z1" },
      }),
    updateZone: vi
      .fn()
      .mockRejectedValue({ code: "zone.department_inactive", params: { zoneId: "z1" } }),
  } as unknown as VenueServiceApi);
  await action(el, "new-zone");
  await type(el, "new-zone-name", "Dining room");
  await chooseOption(field(el, "new-zone-department"), "Restaurant and bar");
  await action(el, "save-editor");
  await action(el, "enable-name-clash");
  expect(fieldError(el, "new-zone-name")).toBe(
    "A disabled zone already has this name. Enable its department or assign it to an active department first.",
  );
  expect(find(el, '[data-test="enable-name-clash"]')).toBeNull();
  expect(await bottom(el)).toBe("Correct the highlighted fields to continue.");
  expect(saveDisabled(el)).toBe(false);
  expect(modal(el)).not.toBeNull();
});

it.each(["department", "zone"] as const)(
  "keeps a refused inline %s Enable ready to retry beside its name",
  async (kind) => {
    const update = vi.fn().mockImplementation(async (_id: string, patch: { active?: boolean }) => {
      if (patch.active) throw new Error("offline");
      throw {
        code: `${kind}.name_disabled`,
        params: { name: "Reserved", [`${kind}Id`]: "target" },
      };
    });
    const el = await mount({
      load: vi.fn().mockResolvedValue(model),
      [kind === "department" ? "updateDepartment" : "updateZone"]: update,
    } as unknown as VenueServiceApi);
    await action(el, `edit-${kind}-name`);
    const control = find(el, `wt-input[name="${kind}Name"]`)!;
    const native = control.shadowRoot!.querySelector("input")!;
    native.value = "Reserved";
    native.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    await settle(el);
    await action(el, `save-${kind}-name`);
    await action(el, "enable-name-clash");
    expect(control.getAttribute("error")).toBe("The change could not be saved.");
    expect(find(el, '[data-test="enable-name-clash"]')).not.toBeNull();
    expect(native.value).toBe("Reserved");
    expect(pageAlert(el)).toBe("");
  },
);
