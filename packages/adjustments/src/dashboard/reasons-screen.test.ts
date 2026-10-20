import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { setLocale, tableNoMatches } from "@waitron/dashboard-kit";
import { applyTokens, setContentLanguages } from "@waitron/ui";
import {
  chooseOption,
  chooseOptions,
  expectFiltersFirst,
  expectRowMenusOnScreen,
  formMessageOf,
} from "@waitron/ui/src/test-helpers.js";
import type { AdjustmentReason, AdjustmentsApi } from "./client.js";
import type { AdjustmentReasonsScreen } from "./reasons-screen.js";
import "./reasons-screen.js";
import { ADJUSTMENTS_STRINGS, actionChoice, kindName, offerName, roleName, tf } from "./strings.js";

const ES = ADJUSTMENTS_STRINGS.es;

const hosts: HTMLElement[] = [];
beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  setLocale("en");
  setContentLanguages({ defaultLanguage: "en", languages: ["en", "es"] });
});
afterEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  setLocale("en");
  setContentLanguages({ defaultLanguage: "en", languages: ["en"] });
  for (const host of hosts.splice(0)) host.remove();
});

const entryError: AdjustmentReason = {
  id: "e",
  name: "Entry error",
  names: { en: "Keyed by mistake", es: "Keyed by mistake (es)" },
  kind: "void",
  actions: ["cancel"],
  maxPercentBp: null,
  maxAmount: null,
  applyRoles: [],
  approverRoles: [],
  noteRequired: false,
  active: true,
  position: 0,
};
const complaint: AdjustmentReason = {
  id: "c",
  name: "Complaint",
  names: { en: "Guest complaint", es: "Guest complaint (es)" },
  kind: "comp",
  actions: ["comp", "discount_percent"],
  maxPercentBp: null,
  maxAmount: "30.00",
  applyRoles: ["supervisor", "manager", "admin"],
  approverRoles: ["manager", "admin"],
  noteRequired: true,
  active: true,
  position: 1,
};
const employee: AdjustmentReason = {
  id: "d",
  name: "Employee discount",
  names: {},
  kind: "comp",
  actions: ["discount_percent"],
  maxPercentBp: 3000,
  maxAmount: "20.00",
  applyRoles: ["supervisor", "manager", "admin"],
  approverRoles: ["manager", "admin"],
  noteRequired: false,
  active: true,
  position: 2,
};
const retired: AdjustmentReason = {
  id: "o",
  name: "Old promotion",
  names: {},
  kind: "comp",
  actions: ["discount_amount"],
  maxPercentBp: null,
  maxAmount: "5.00",
  applyRoles: ["staff", "supervisor", "manager", "admin"],
  approverRoles: ["manager", "admin"],
  noteRequired: false,
  active: false,
  position: 3,
};
const reasons = [entryError, complaint, employee, retired];

it("names the reasons Filters panel in Spanish", async () => {
  setLocale("es");
  const el = await mount(fakeApi());
  const table = el.shadowRoot!.querySelector("wt-data-table")!;
  expect(table.shadowRoot!.querySelector(".filters-trigger")!.getAttribute("aria-label")).toBe(
    `${ES["adjustments.filters"]} 1`,
  );
});

type FakeApi = {
  [K in keyof AdjustmentsApi]: AdjustmentsApi[K] extends (...args: infer A) => infer R
    ? ReturnType<typeof vi.fn<(...args: A) => R>>
    : AdjustmentsApi[K];
};

function fakeApi(overrides: Partial<Record<keyof AdjustmentsApi, unknown>> = {}): FakeApi {
  const api = {
    liveData: undefined,
    listReasons: vi.fn().mockResolvedValue(reasons),
    createReason: vi.fn().mockResolvedValue({ ...complaint, id: "n" }),
    updateReason: vi.fn().mockResolvedValue(complaint),
    deactivateReason: vi.fn().mockResolvedValue(undefined),
    reorderReasons: vi.fn().mockResolvedValue(undefined),
    getSettings: vi
      .fn()
      .mockResolvedValue({ maxBillComp: null, billApproverRoles: ["manager", "admin"] }),
    saveSettings: vi.fn(async (settings: unknown) => settings),
    ...overrides,
  } as unknown as FakeApi;
  if (!("background" in overrides)) (api as { background: unknown }).background = api;
  return api;
}

async function settle(el: AdjustmentReasonsScreen): Promise<void> {
  for (let i = 0; i < 3; i++) {
    await el.updateComplete;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  await el.updateComplete;
}

async function mount(api: FakeApi): Promise<AdjustmentReasonsScreen> {
  const host = document.createElement("div");
  applyTokens(host);
  document.body.appendChild(host);
  hosts.push(host);
  const el = document.createElement(
    "dashboard-adjustment-reasons-screen",
  ) as AdjustmentReasonsScreen;
  el.api = api as unknown as AdjustmentsApi;
  host.appendChild(el);
  await settle(el);
  return el;
}

function find(el: AdjustmentReasonsScreen, selector: string): HTMLElement | null {
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

function table(el: AdjustmentReasonsScreen): HTMLElement {
  return el.shadowRoot!.querySelector<HTMLElement>('[data-test="reasons"]')!;
}

function rowKeys(el: AdjustmentReasonsScreen): string[] {
  return [...table(el).shadowRoot!.querySelectorAll("tbody tr[data-row-key]")].map((row) =>
    row.getAttribute("data-row-key")!,
  );
}

function rowText(el: AdjustmentReasonsScreen, key: string): string {
  return table(el).shadowRoot!.querySelector(`tr[data-row-key="${key}"]`)!.textContent!;
}

async function press(el: AdjustmentReasonsScreen, test: string): Promise<void> {
  const button = find(el, `[data-test="${test}"]`);
  expect(button, test).not.toBeNull();
  const menu = button!.closest("wt-row-actions");
  if (menu) menu.shadowRoot!.querySelector<HTMLButtonElement>("button")!.click();
  button!.click();
  await settle(el);
}

function modal(el: AdjustmentReasonsScreen): HTMLElement | null {
  return el.shadowRoot!.querySelector("wt-modal");
}

type Named = HTMLElement & { value: string; error?: string; checked?: boolean };
function field(el: AdjustmentReasonsScreen, name: string): Named {
  const found = el.shadowRoot!.querySelector<Named>(`[name="${name}"]`);
  expect(found, name).not.toBeNull();
  return found!;
}

async function type(el: AdjustmentReasonsScreen, name: string, value: string): Promise<void> {
  const input = field(el, name).shadowRoot!.querySelector("input")!;
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  await settle(el);
}

async function choose(el: AdjustmentReasonsScreen, name: string, value: string): Promise<void> {
  await chooseOption(field(el, name), value);
  await settle(el);
}

type RoleField = Named & {
  label: string;
  hint: string;
  search: string;
  multiple: boolean;
  required: boolean;
  values: string[];
  options: { value: string; label: string }[];
};
function roleField(el: AdjustmentReasonsScreen, name: string): RoleField {
  return field(el, name) as RoleField;
}

async function chooseRoles(
  el: AdjustmentReasonsScreen,
  name: string,
  values: string[],
): Promise<void> {
  await chooseOptions(field(el, name), values);
  await settle(el);
}

/** What the closed role list shows on its button. */
async function closedText(el: AdjustmentReasonsScreen, name: string): Promise<string> {
  const box = field(el, name) as Named & { updateComplete: Promise<unknown> };
  await box.updateComplete;
  return box.shadowRoot!.querySelector(".trigger")!.textContent!.trim();
}

/** The shared dropdown's own button, which carries its invalid mark. */
function roleTrigger(el: AdjustmentReasonsScreen, name: string): HTMLButtonElement {
  return field(el, name).shadowRoot!.querySelector<HTMLButtonElement>(".trigger")!;
}

function actionBox(el: AdjustmentReasonsScreen, action: string): HTMLInputElement {
  return el.shadowRoot!.querySelector<HTMLInputElement>(
    `input[name="actions"][value="${action}"]`,
  )!;
}

async function toggleAction(el: AdjustmentReasonsScreen, action: string): Promise<void> {
  actionBox(el, action).click();
  await settle(el);
}

function noteSwitch(el: AdjustmentReasonsScreen): HTMLInputElement {
  return field(el, "noteRequired").shadowRoot!.querySelector("input")!;
}

/** The message shown beside a field: a text or price field's own error, or the line under a group. */
function besideField(el: AdjustmentReasonsScreen, key: string): string {
  const input = el.shadowRoot!.querySelector<Named>(
    `wt-input[name="${key}"], wt-price-input[name="${key}"], wt-combobox[name="${key}"], wt-segmented-control[name="${key}"]`,
  );
  if (input) return input.error ?? "";
  return el.shadowRoot!.querySelector(`[data-field-error="${key}"]`)?.textContent?.trim() ?? "";
}

/** The screen's own alert, outside any form. */
function alert(el: AdjustmentReasonsScreen): string {
  return el.shadowRoot!.querySelector('[data-test="page-alert"]')?.textContent?.trim() ?? "";
}

/** The open form's one message, shown in the dialog's footer above the buttons. */
async function bottom(el: AdjustmentReasonsScreen): Promise<string> {
  const actions = modal(el)!.querySelector("wt-form-actions")!;
  return (await formMessageOf(actions))?.textContent?.trim() ?? "";
}

function button(el: AdjustmentReasonsScreen, test: string): HTMLElement & { disabled: boolean } {
  return find(el, `[data-test="${test}"]`) as HTMLElement & { disabled: boolean };
}

const FIX_FIELDS = "Correct the highlighted fields to continue.";

describe("the reasons list", () => {
  it("puts Add reason under the empty table's sentence, opening the same editor", async () => {
    const el = await mount(fakeApi({ listReasons: vi.fn().mockResolvedValue([]) }));
    const button = table(el).querySelector<HTMLElement>(":scope > [slot=empty-action]")!;
    expect(button.assignedSlot).not.toBeNull();
    expect(button.textContent!.trim()).toBe("Add reason");
    button.click();
    await settle(el);
    expect(modal(el)!.getAttribute("heading")).toBe("Add reason");
  });

  it("draws no Add reason in the table once reasons exist", async () => {
    const el = await mount(fakeApi());
    expect(table(el).querySelector(":scope > [slot=empty-action]")).toBeNull();
  });

  it("returns focus to the toolbar's Add reason after the first reason is made from the empty table", async () => {
    const api = fakeApi({
      listReasons: vi.fn().mockResolvedValueOnce([]).mockResolvedValue([complaint]),
    });
    const el = await mount(api);
    table(el).querySelector<HTMLElement>(":scope > [slot=empty-action]")!.click();
    await settle(el);
    await type(el, "name", "Birthday");
    await toggleAction(el, "comp");
    await press(el, "save-editor");
    expect(api.createReason).toHaveBeenCalledOnce();
    expect(el.shadowRoot!.activeElement).toBe(
      el.shadowRoot!.querySelector('.toolbar [data-test="add-reason"]'),
    );
  });

  it("returns focus to the empty table's Add reason after Cancel", async () => {
    const api = fakeApi({ listReasons: vi.fn().mockResolvedValue([]) });
    const el = await mount(api);
    const button = table(el).querySelector<HTMLElement>(":scope > [slot=empty-action]")!;
    button.click();
    await settle(el);
    await press(el, "cancel-editor");
    expect(modal(el)).toBeNull();
    expect(el.shadowRoot!.activeElement).toBe(button);
    expect(api.createReason).not.toHaveBeenCalled();
  });

  it("lists the active reasons in their order, with what each allows, its limits and roles", async () => {
    const el = await mount(fakeApi());
    expect(rowKeys(el)).toEqual(["e", "c", "d"]);
    const text = rowText(el, "c");
    expect(text).toContain("Complaint");
    expect(text).not.toContain("Guest complaint");
    expect(text).toContain("Free");
    expect(text).toContain("Percentage discount");
    expect(rowText(el, "d")).toContain("Up to 30% off an item");
    expect(text).toContain("Up to €30.00 off a bill");
    expect(text).toContain("Supervisor, Manager, Admin");
    expect(text).toContain("Approves: Manager, Admin");
    expect(text).toContain("Note required");
    expect(rowText(el, "e")).toContain("No limit");
    expect(rowText(el, "e")).toContain("Void");
  });

  it("shows the disabled reasons when the status filter asks for them, without reorder buttons", async () => {
    const el = await mount(fakeApi());
    const filter = table(el).shadowRoot!.querySelector<HTMLElement & { value: string }>(
      'wt-combobox[data-filter="status"]',
    )!;
    expect(filter.value).toBe("active");
    await chooseOption(filter, "inactive");
    await settle(el);
    expect(rowKeys(el)).toEqual(["o"]);
    expect(rowText(el, "o")).toContain("Disabled");
    expect(rowText(el, "o")).not.toContain("Inactive");
    expect(find(el, '[data-test="move-up-o"]')).toBeNull();
    expect(find(el, '[data-test="deactivate-o"]')).toBeNull();
    expect(find(el, '[data-test="edit-o"]')).not.toBeNull();
  });

  it.each(["en", "es"])(
    "says the dashboard's one no-matches sentence when the status filter hides every reason (%s)",
    async (locale) => {
      setLocale(locale);
      const el = await mount(fakeApi({ listReasons: vi.fn().mockResolvedValue([complaint]) }));
      await chooseOption(
        table(el).shadowRoot!.querySelector<HTMLElement & { value: string }>(
          'wt-combobox[data-filter="status"]',
        )!,
        "inactive",
      );
      await settle(el);
      expect(rowKeys(el)).toEqual([]);
      expect(table(el).shadowRoot!.querySelector(".message")!.textContent).toBe(
        tableNoMatches(locale),
      );
    },
  );

  it("reads the whole list, inactive reasons included, and later reads passively", async () => {
    const background = { listReasons: vi.fn().mockResolvedValue(reasons) };
    const api = fakeApi({ background });
    const el = await mount(api);
    expect(api.listReasons).toHaveBeenCalledTimes(1);
    await press(el, "move-down-e");
    expect(background.listReasons).toHaveBeenCalledTimes(1);
  });

  it("says the list could not be loaded", async () => {
    const el = await mount(fakeApi({ listReasons: vi.fn().mockRejectedValue({ code: "x" }) }));
    expect(alert(el)).toBe("The adjustment reasons could not be loaded.");
    expect(el.shadowRoot!.querySelector('[data-test="page-alert"]')!.getAttribute("role")).toBe(
      "alert",
    );
  });

  it("speaks Spanish when the dashboard does", async () => {
    setLocale("es");
    const el = await mount(fakeApi());
    expect(el.shadowRoot!.querySelector("h1")!.textContent!.trim()).toBe(ES["adjustments.title"]);
    expect(el.shadowRoot!.querySelector(".intro")!.textContent!.trim()).toBe(
      ES["adjustments.intro"],
    );
    expect(table(el).getAttribute("aria-label")).toBe(ES["adjustments.title"]);
    const text = rowText(el, "c");
    expect(text).toContain(offerName("comp", "es"));
    expect(rowText(el, "d")).toContain(tf("adjustments.limit_percent", { percent: "30" }, "es"));
    expect(text).toContain(tf("adjustments.limit_amount", { amount: "30,00\u00a0€" }, "es"));
    expect(text).toContain(
      tf(
        "adjustments.approves",
        { roles: `${roleName("manager", "es")}, ${roleName("admin", "es")}` },
        "es",
      ),
    );
    expect(rowText(el, "e")).toContain(kindName("void", "es"));
    const filter = table(el).shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>(
      'wt-combobox[data-filter="status"]',
    )!;
    expect([filter.searchPlaceholder, filter.noResultsLabel]).toEqual([
      ES["adjustments.combobox_search"],
      ES["adjustments.combobox_no_results"],
    ]);
  });
});

describe("the reasons list's column chooser", () => {
  type Table = HTMLElement & { updateComplete: Promise<unknown> };
  const chooser = (el: AdjustmentReasonsScreen) =>
    table(el).shadowRoot!.querySelector(".columns-trigger")!.getAttribute("aria-label");
  const choices = (el: AdjustmentReasonsScreen) =>
    [...table(el).shadowRoot!.querySelectorAll<HTMLInputElement>("input[data-column]")].map(
      (box) => [box.dataset.column, box.checked],
    );
  const headers = (el: AdjustmentReasonsScreen) =>
    [...table(el).shadowRoot!.querySelectorAll("thead th")].map((th) => th.textContent!.trim());

  it("offers every column but the name and the row's controls, and remembers a hidden one", async () => {
    const el = await mount(fakeApi());
    expect(chooser(el)).toBe("Customise columns");
    expect(choices(el)).toEqual([
      ["allows", true],
      ["limits", true],
      ["roles", true],
      ["status", true],
    ]);
    expect(headers(el)).toEqual([
      "Name",
      "Allows",
      "Limits",
      "Who applies it",
      "Status",
      "Actions",
    ]);
    const box = table(el).shadowRoot!.querySelector<HTMLInputElement>(
      'input[data-column="limits"]',
    )!;
    box.checked = false;
    box.dispatchEvent(new Event("change"));
    await (table(el) as Table).updateComplete;
    expect(headers(el)).toEqual(["Name", "Allows", "Who applies it", "Status", "Actions"]);
    expect(JSON.parse(localStorage.getItem("waitron.adjustments.reasons.table:columns")!)).toEqual({
      limits: false,
    });
  });

  it("names the chooser in Spanish when the dashboard speaks it", async () => {
    setLocale("es");
    const el = await mount(fakeApi());
    expect(chooser(el)).toBe(ES["adjustments.customise_columns"]);
  });

  it("words a column that is always shown, and the last one shown, in Spanish", async () => {
    setLocale("es");
    const el = await mount(fakeApi());
    const list = table(el) as Table & {
      alwaysShownColumnLabel: string;
      lastShownColumnLabel: string;
    };
    expect(list.alwaysShownColumnLabel).toBe(ES["adjustments.column_always_shown"]);
    expect(list.lastShownColumnLabel).toBe(ES["adjustments.column_last_shown"]);
  });
});

describe("at phone width", () => {
  const longName = "Guest complaint about the long wait for a table on the terrace (es)";

  it("puts the row controls in the last column, pinned to the table's edge", async () => {
    const el = await mount(fakeApi());
    const heads = [...table(el).shadowRoot!.querySelectorAll("thead th")];
    expect(heads.at(-1)!.textContent!.trim()).toBe("Actions");
    expect(heads.at(-1)!.getAttribute("data-pinned")).toBe("end");
    for (const row of table(el).shadowRoot!.querySelectorAll("tbody tr[data-row-key]")) {
      const last = row.querySelector("td:last-child")!;
      expect(last.getAttribute("data-pinned")).toBe("end");
      expect(last.querySelector("wt-row-actions")).not.toBeNull();
    }
  });

  it.each(["en", "es"])(
    "keeps every reason row's menu and move buttons on screen and uncovered while the other columns scroll sideways (390 px, %s)",
    async (locale) => {
      const width = window.innerWidth,
        height = window.innerHeight;
      try {
        setLocale(locale);
        await page.viewport(390, 844);
        expect(window.innerWidth).toBe(390);
        const long = { ...complaint, name: longName, names: { en: longName, es: longName } };
        const el = await mount(
          fakeApi({ listReasons: vi.fn().mockResolvedValue([entryError, long]) }),
        );
        expectRowMenusOnScreen(table(el), 2);
        const box = table(el).shadowRoot!.querySelector(".scroll")!.getBoundingClientRect();
        for (const test of ["move-up-e", "move-down-e", "move-up-c", "move-down-c"]) {
          const button = find(el, `[data-test="${test}"]`)!;
          const at = button.getBoundingClientRect();
          expect(at.right, test).toBeLessThanOrEqual(Math.min(box.right, window.innerWidth));
          expect(at.left, test).toBeGreaterThanOrEqual(box.left);
          const root = button.getRootNode() as ShadowRoot;
          expect(root, test).toBe(table(el).shadowRoot);
          const hit = root.elementFromPoint(at.x + at.width / 2, at.y + at.height / 2);
          expect(hit !== null && button.contains(hit), `${test} is covered`).toBe(true);
        }
      } finally {
        await page.viewport(width, height);
      }
    },
  );
});

describe("reordering", () => {
  it("moves a reason up or down with buttons, sending the whole active order", async () => {
    const api = fakeApi();
    const el = await mount(api);
    await press(el, "move-up-c");
    expect(api.reorderReasons).toHaveBeenLastCalledWith(["c", "e", "d"]);
    await press(el, "move-down-c");
    expect(api.reorderReasons).toHaveBeenLastCalledWith(["e", "d", "c"]);
    expect(api.listReasons).toHaveBeenCalledTimes(3);
  });

  it("offers no move beyond either end, and names the reason each button moves", async () => {
    const el = await mount(fakeApi());
    const firstUp = find(el, '[data-test="move-up-e"]') as HTMLElement & { disabled: boolean };
    const lastDown = find(el, '[data-test="move-down-d"]') as HTMLElement & { disabled: boolean };
    expect(firstUp.disabled).toBe(true);
    expect(lastDown.disabled).toBe(true);
    const up = find(el, '[data-test="move-up-c"]')!;
    expect((up as HTMLElement & { disabled: boolean }).disabled).toBe(false);
    expect(up.getAttribute("aria-label")).toBe("Move up: Complaint");
    expect(up.textContent).toContain("Move up");
  });

  it("keeps focus on the moved reason's button, or its other button at an end", async () => {
    const api = fakeApi({
      listReasons: vi
        .fn()
        .mockResolvedValueOnce(reasons)
        .mockResolvedValueOnce([complaint, entryError, employee, retired])
        .mockResolvedValue([complaint, employee, entryError, retired]),
    });
    const el = await mount(api);
    const focused = () => table(el).shadowRoot!.activeElement?.getAttribute("data-test");
    await press(el, "move-down-e");
    expect(api.reorderReasons).toHaveBeenLastCalledWith(["c", "e", "d"]);
    expect(focused()).toBe("move-down-e");
    await press(el, "move-down-e");
    expect(api.reorderReasons).toHaveBeenLastCalledWith(["c", "d", "e"]);
    expect(focused()).toBe("move-up-e");
  });

  it("sends one reorder while one is in flight", async () => {
    let finish!: () => void;
    const api = fakeApi({
      reorderReasons: vi.fn(() => new Promise<void>((resolve) => (finish = resolve))),
    });
    const el = await mount(api);
    await press(el, "move-up-c");
    await press(el, "move-down-c");
    expect(api.reorderReasons).toHaveBeenCalledTimes(1);
    finish();
    await settle(el);
  });

  it("reloads the list after a refused reorder, so a retry works from the current order", async () => {
    const api = fakeApi({
      reorderReasons: vi.fn().mockRejectedValue({
        code: "adjustment_reason.invalid",
        params: { field: "ids" },
      }),
    });
    const el = await mount(api);
    await press(el, "move-up-c");
    expect(api.listReasons).toHaveBeenCalledTimes(2);
    expect(alert(el)).toBe("The new order could not be saved.");
  });

  it("says when the new order could not be saved", async () => {
    const el = await mount(
      fakeApi({ reorderReasons: vi.fn().mockRejectedValue({ code: "server.internal" }) }),
    );
    await press(el, "move-up-c");
    expect(alert(el)).toBe("The new order could not be saved.");
  });
});

describe("the editor", () => {
  it.each([
    ["en", ["admin", "manager", "staff", "supervisor"]],
    ["es", ["admin", "staff", "manager", "supervisor"]],
  ] as const)("lists both role choices by their displayed name in %s", async (locale, roles) => {
    setLocale(locale);
    const el = await mount(fakeApi());
    await press(el, "edit-c");
    for (const name of ["applyRoles", "approverRoles"]) {
      const select = roleField(el, name);
      expect(select.options.map((option) => option.value)).toEqual(roles);
    }
    expect(roleField(el, "applyRoles").values).toEqual(["supervisor", "manager", "admin"]);
    expect(roleField(el, "approverRoles").values).toEqual(["manager", "admin"]);
  });

  it.each([
    [
      "en",
      "Who can apply it",
      "Who can approve it",
      "They use it straight away, up to its limits.",
      "They enter their PIN when anyone else asks, or above a limit.",
    ],
    [
      "es",
      ES["adjustments.field.apply_roles"],
      ES["adjustments.field.approver_roles"],
      ES["adjustments.field.apply_roles_hint"],
      ES["adjustments.field.approver_roles_hint"],
    ],
  ] as const)(
    "draws both role lists as the shared multiple dropdown, labelled, required and hinted, in %s",
    async (locale, applyLabel, approverLabel, applyHint, approverHint) => {
      setLocale(locale);
      const el = await mount(fakeApi());
      await press(el, "edit-c");
      const apply = roleField(el, "applyRoles");
      const approver = roleField(el, "approverRoles");
      for (const [box, label, hint] of [
        [apply, applyLabel, applyHint],
        [approver, approverLabel, approverHint],
      ] as const) {
        expect(box.tagName).toBe("WT-COMBOBOX");
        expect(box.multiple).toBe(true);
        expect(box.required).toBe(true);
        expect(box.label).toBe(label);
        expect(box.hint).toBe(hint);
      }
    },
  );

  it("names the chosen roles in the closed field, and Everyone for all four", async () => {
    const el = await mount(fakeApi());
    await press(el, "edit-c");
    expect(await closedText(el, "applyRoles")).toBe("Supervisor, Manager, Admin");
    expect(await closedText(el, "approverRoles")).toBe("Manager, Admin");
    await chooseRoles(el, "applyRoles", ["admin", "staff", "manager", "supervisor"]);
    expect(await closedText(el, "applyRoles")).toBe("Everyone");
    await chooseRoles(el, "approverRoles", ["admin"]);
    expect(await closedText(el, "approverRoles")).toBe("Admin");
  });

  it("names the chosen roles, and everyone for all four, in Spanish", async () => {
    setLocale("es");
    const el = await mount(fakeApi());
    await press(el, "edit-c");
    await chooseRoles(el, "approverRoles", ["admin", "manager"]);
    expect(await closedText(el, "approverRoles")).toBe(
      `${roleName("manager", "es")}, ${roleName("admin", "es")}`,
    );
    await chooseRoles(el, "approverRoles", ["staff", "supervisor", "manager", "admin"]);
    expect(await closedText(el, "approverRoles")).toBe(ES["adjustments.everyone"]);
  });

  it("keeps a role list's change inside the screen", async () => {
    const el = await mount(fakeApi());
    await press(el, "edit-c");
    const heard = vi.fn();
    document.addEventListener("wt-change", heard);
    try {
      await chooseRoles(el, "applyRoles", ["manager"]);
    } finally {
      document.removeEventListener("wt-change", heard);
    }
    expect(heard).not.toHaveBeenCalled();
  });

  it("refuses an empty list beside its field and keeps Save disabled", async () => {
    const api = fakeApi();
    const el = await mount(api);
    await press(el, "edit-c");
    await chooseRoles(el, "approverRoles", []);
    await press(el, "save-editor");
    expect(api.updateReason).not.toHaveBeenCalled();
    expect(besideField(el, "approverRoles")).toBe("Choose at least one role.");
    expect(besideField(el, "applyRoles")).toBe("");
    expect(await bottom(el)).toBe(FIX_FIELDS);
    expect(button(el, "save-editor").disabled).toBe(true);
    expect(el.shadowRoot!.activeElement).toBe(field(el, "approverRoles"));
    expect(roleTrigger(el, "approverRoles").getAttribute("aria-invalid")).toBe("true");
    await chooseRoles(el, "applyRoles", []);
    expect(besideField(el, "applyRoles")).toBe("Choose at least one role.");
    await chooseRoles(el, "applyRoles", ["staff"]);
    await chooseRoles(el, "approverRoles", ["admin"]);
    expect(button(el, "save-editor").disabled).toBe(false);
    await press(el, "save-editor");
    expect(api.updateReason.mock.calls[0]![1]).toMatchObject({
      applyRoles: ["staff"],
      approverRoles: ["admin"],
    });
  });

  it("refuses an empty list in Spanish", async () => {
    setLocale("es");
    const el = await mount(fakeApi());
    await press(el, "edit-c");
    await chooseRoles(el, "applyRoles", []);
    await press(el, "save-editor");
    expect(besideField(el, "applyRoles")).toBe(ES["adjustments.error.applyRoles"]);
  });

  it("refuses Free under a 50% item limit", async () => {
    const api = fakeApi();
    const el = await mount(api);
    await press(el, "edit-c");
    await type(el, "maxPercent", "50");
    await press(el, "save-editor");
    expect(api.updateReason).not.toHaveBeenCalled();
    expect(besideField(el, "maxPercent")).toBe(
      "Free takes 100% off: raise this limit or untick Free.",
    );
    expect(button(el, "save-editor").disabled).toBe(true);
    await type(el, "maxPercent", "100");
    expect(besideField(el, "maxPercent")).toBe("");
    await type(el, "maxPercent", "50");
    await toggleAction(el, "comp");
    expect(besideField(el, "maxPercent")).toBe("");
    await press(el, "save-editor");
    expect(api.updateReason.mock.calls[0]![1]).toMatchObject({
      actions: ["discount_percent"],
      maxPercentBp: 5000,
    });
  });

  it("refuses Free under an item limit in Spanish", async () => {
    setLocale("es");
    const el = await mount(fakeApi());
    await press(el, "edit-c");
    await type(el, "maxPercent", "50");
    await press(el, "save-editor");
    expect(besideField(el, "maxPercent")).toBe(ES["adjustments.error.free_over_limit"]);
  });

  it("locks both role lists and the kind while a save is in flight", async () => {
    const api = fakeApi({ updateReason: vi.fn(() => new Promise<AdjustmentReason>(() => {})) });
    const el = await mount(api);
    await press(el, "edit-c");
    await type(el, "name", "Edited complaint");
    await press(el, "save-editor");
    expect(roleTrigger(el, "applyRoles").disabled).toBe(true);
    expect(roleTrigger(el, "approverRoles").disabled).toBe(true);
    expect((field(el, "kind") as Named & { disabled: boolean }).disabled).toBe(true);
  });

  it("holds both role fields, their labels and a role error to the form width on a wide window", async () => {
    const width = window.innerWidth,
      height = window.innerHeight;
    await page.viewport(1280, 800);
    try {
      const el = await mount(fakeApi());
      await press(el, "edit-c");
      await chooseRoles(el, "approverRoles", []);
      await press(el, "save-editor");
      const probe = document.createElement("div");
      probe.style.width = "var(--wt-form-max-width)";
      el.shadowRoot!.appendChild(probe);
      const form = probe.getBoundingClientRect().width;
      expect(modal(el)!.shadowRoot!.querySelector(".body")!.clientWidth).toBeGreaterThan(form);
      const boxes = [...modal(el)!.querySelectorAll("wt-combobox")];
      const parts = [
        ...boxes,
        ...boxes.flatMap((box) => [...box.shadowRoot!.querySelectorAll("[data-error]")]),
      ];
      expect(parts).toHaveLength(3);
      for (const part of parts) {
        expect(part.getBoundingClientRect().width, part.outerHTML).toBeCloseTo(form, 0);
      }
    } finally {
      await page.viewport(width, height);
    }
  });

  it.each([
    ["en", "Kind", ["Void", "Comp"]],
    ["es", ES["adjustments.field.kind"], [kindName("void", "es"), kindName("comp", "es")]],
  ] as const)(
    "asks for the kind first, as a segmented choice, in %s",
    async (locale, label, words) => {
      setLocale(locale);
      const el = await mount(fakeApi());
      await press(el, "edit-c");
      const kind = field(el, "kind") as Named & {
        label: string;
        options: { value: string; label: string }[];
      };
      expect(kind.tagName).toBe("WT-SEGMENTED-CONTROL");
      expect(kind.label).toBe(label);
      expect(kind.options).toEqual([
        { value: "void", label: words[0] },
        { value: "comp", label: words[1] },
      ]);
      expect(kind.value).toBe("comp");
      const form = modal(el)!.querySelector(".form")!;
      expect(form.firstElementChild).toBe(kind);
    },
  );

  it("shows only Kind, Name and Note required for a Void reason, with the refund-permission line", async () => {
    const el = await mount(fakeApi());
    await press(el, "edit-e");
    expect(field(el, "kind").value).toBe("void");
    expect(field(el, "name").value).toBe("Entry error");
    expect(field(el, "names-es").value).toBe("Keyed by mistake (es)");
    for (const name of ["applyRoles", "approverRoles", "maxPercent", "maxAmount"]) {
      expect(el.shadowRoot!.querySelector(`[name="${name}"]`), name).toBeNull();
    }
    expect(el.shadowRoot!.querySelector('input[name="actions"]')).toBeNull();
    expect(noteSwitch(el)).not.toBeNull();
    expect(modal(el)!.querySelector('[data-test="note-hint"]')!.textContent!.trim()).toBe(
      "The till asks for the note with “Say why”.",
    );
    expect(modal(el)!.querySelector('[data-test="void-rule"]')!.textContent!.trim()).toBe(
      "Who may cancel is set by the refund permission, not by the reason.",
    );
  });

  it("says the Void reason's lines in Spanish", async () => {
    setLocale("es");
    const el = await mount(fakeApi());
    await press(el, "edit-e");
    expect(modal(el)!.querySelector('[data-test="note-hint"]')!.textContent!.trim()).toBe(
      ES["adjustments.field.note_required_void_hint"],
    );
    expect(modal(el)!.querySelector('[data-test="void-rule"]')!.textContent!.trim()).toBe(
      ES["adjustments.void_rule"],
    );
  });

  it.each([
    [
      "en",
      ["Who can apply it", "Who can approve it", "Most off one item", "Most off one bill"],
      ["Free (100%)", "A percentage", "An amount"],
      "How it can be taken off",
      "Note required",
    ],
    [
      "es",
      [
        ES["adjustments.field.apply_roles"],
        ES["adjustments.field.approver_roles"],
        ES["adjustments.field.max_percent"],
        ES["adjustments.field.max_amount"],
      ],
      [
        actionChoice("comp", "es"),
        actionChoice("discount_percent", "es"),
        actionChoice("discount_amount", "es"),
      ],
      ES["adjustments.field.actions"],
      ES["adjustments.field.note_required"],
    ],
  ] as const)(
    "shows both lists, the offers and both limits for a Comp reason (%s)",
    async (locale, labels, offers, offersLabel, noteLabel) => {
      setLocale(locale);
      const el = await mount(fakeApi());
      await press(el, "edit-c");
      const order = [...modal(el)!.querySelectorAll<Named & { label: string }>("[name]")]
        .map((each) => each.getAttribute("name"))
        .filter((name, index, all) => all.indexOf(name) === index);
      expect(order).toEqual([
        "kind",
        "name",
        "names-en",
        "names-es",
        "applyRoles",
        "approverRoles",
        "actions",
        "maxPercent",
        "maxAmount",
        "noteRequired",
      ]);
      expect(
        ["applyRoles", "approverRoles", "maxPercent", "maxAmount"].map(
          (name) => (field(el, name) as Named & { label: string }).label,
        ),
      ).toEqual(labels);
      expect(
        ["comp", "discount_percent", "discount_amount"].map((action) =>
          actionBox(el, action).closest("label")!.textContent!.trim(),
        ),
      ).toEqual(offers);
      expect(modal(el)!.querySelector("fieldset.offers legend")!.textContent).toContain(
        offersLabel,
      );
      expect((field(el, "noteRequired") as Named & { label: string }).label).toBe(noteLabel);
      expect(modal(el)!.querySelector('[data-test="void-rule"]')).toBeNull();
      expect(modal(el)!.querySelector('[data-test="note-hint"]')).toBeNull();
    },
  );

  it.each([
    [
      "en",
      "No limit",
      "Everything this reason took off the item counts.",
      "The venue's own amount. Above it, someone who can approve it is asked.",
    ],
    [
      "es",
      ES["adjustments.no_limit"],
      ES["adjustments.field.max_percent_hint"],
      ES["adjustments.field.max_amount_hint"],
    ],
  ] as const)(
    "hints both limits and says an empty one is no limit (%s)",
    async (locale, none, item, bill) => {
      setLocale(locale);
      const el = await mount(fakeApi());
      await press(el, "edit-c");
      const percent = field(el, "maxPercent") as Named & { placeholder: string; hint: string };
      const money = field(el, "maxAmount") as Named & { placeholder: string; hint: string };
      expect([percent.placeholder, percent.hint]).toEqual([none, item]);
      expect([money.placeholder, money.hint]).toEqual([none, bill]);
    },
  );

  it("clears the Comp fields when the kind changes to Void, and sends none", async () => {
    const api = fakeApi();
    const el = await mount(api);
    await press(el, "edit-c");
    await choose(el, "kind", "void");
    expect(el.shadowRoot!.querySelector('[name="applyRoles"]')).toBeNull();
    await press(el, "save-editor");
    expect(api.updateReason).toHaveBeenCalledWith("c", {
      name: "Complaint",
      names: { en: "Guest complaint", es: "Guest complaint (es)" },
      kind: "void",
      actions: ["cancel"],
      maxPercentBp: null,
      maxAmount: null,
      applyRoles: [],
      approverRoles: [],
      noteRequired: true,
    });
  });

  it("starts a Void reason turned Comp with nothing chosen, so it must be filled in", async () => {
    const api = fakeApi();
    const el = await mount(api);
    await press(el, "edit-c");
    await choose(el, "kind", "void");
    await choose(el, "kind", "comp");
    expect(roleField(el, "applyRoles").values).toEqual([]);
    expect(roleField(el, "approverRoles").values).toEqual([]);
    expect(actionBox(el, "comp").checked).toBe(false);
    expect(field(el, "maxAmount").value).toBe("");
    await press(el, "save-editor");
    expect(api.updateReason).not.toHaveBeenCalled();
    expect(besideField(el, "applyRoles")).toBe("Choose at least one role.");
    expect(besideField(el, "approverRoles")).toBe("Choose at least one role.");
    expect(besideField(el, "actions")).toBe("Choose at least one action.");
  });

  it("sends kind, applyRoles and approverRoles", async () => {
    const api = fakeApi();
    const el = await mount(api);
    await press(el, "edit-e");
    await choose(el, "kind", "comp");
    await toggleAction(el, "discount_amount");
    await chooseRoles(el, "applyRoles", ["admin", "staff"]);
    await chooseRoles(el, "approverRoles", ["manager", "admin"]);
    await type(el, "maxAmount", "12");
    await press(el, "save-editor");
    expect(api.updateReason).toHaveBeenCalledTimes(1);
    expect(api.updateReason.mock.calls[0]).toEqual([
      "e",
      {
        name: "Entry error",
        names: { en: "Keyed by mistake", es: "Keyed by mistake (es)" },
        kind: "comp",
        actions: ["discount_amount"],
        maxPercentBp: null,
        maxAmount: "12",
        applyRoles: ["staff", "admin"],
        approverRoles: ["manager", "admin"],
        noteRequired: false,
      },
    ]);
  });

  it.each([
    [false, "kind", "A venue keeps at least one Void reason."],
    [true, "noteRequired", "A venue keeps at least one Void reason that asks for a note."],
  ] as const)(
    "shows void_required under Kind, and under Note required with withNote (withNote=%s)",
    async (withNote, under, message) => {
      const el = await mount(
        fakeApi({
          updateReason: vi
            .fn()
            .mockRejectedValue({ code: "adjustment_reason.void_required", params: { withNote } }),
        }),
      );
      await press(el, "edit-e");
      await type(el, "name", "Wrong key");
      await press(el, "save-editor");
      expect(besideField(el, under)).toBe(message);
      expect(besideField(el, under === "kind" ? "noteRequired" : "kind")).toBe("");
      expect(await bottom(el)).toBe(FIX_FIELDS);
      expect(button(el, "save-editor").disabled).toBe(false);
    },
  );

  it.each([
    [false, ES["adjustments.error.void_required"]],
    [true, ES["adjustments.error.void_required_note"]],
  ] as const)("says void_required in Spanish (withNote=%s)", async (withNote, message) => {
    setLocale("es");
    const el = await mount(
      fakeApi({
        updateReason: vi
          .fn()
          .mockRejectedValue({ code: "adjustment_reason.void_required", params: { withNote } }),
      }),
    );
    await press(el, "edit-e");
    await type(el, "name", "Error");
    await press(el, "save-editor");
    expect(besideField(el, withNote ? "noteRequired" : "kind")).toBe(message);
  });

  it("opens with every field of the reason, each with a semantic name", async () => {
    const el = await mount(fakeApi());
    await press(el, "edit-c");
    expect(modal(el)!.getAttribute("heading")).toBe("Edit reason");
    expect(field(el, "name").value).toBe("Complaint");
    expect(field(el, "names-en").value).toBe("Guest complaint");
    expect(field(el, "names-es").value).toBe("Guest complaint (es)");
    expect(actionBox(el, "cancel")).toBeNull();
    expect(actionBox(el, "comp").checked).toBe(true);
    expect(actionBox(el, "discount_percent").checked).toBe(true);
    expect(actionBox(el, "discount_amount").checked).toBe(false);
    expect(field(el, "maxPercent").value).toBe("");
    expect(field(el, "maxAmount").value).toBe("30.00");
    expect(roleField(el, "applyRoles").values).toEqual(["supervisor", "manager", "admin"]);
    expect(roleField(el, "approverRoles").values).toEqual(["manager", "admin"]);
    expect(noteSwitch(el).checked).toBe(true);
    for (const input of modal(el)!.querySelectorAll(
      "wt-segmented-control, wt-input, wt-price-input, wt-combobox, input, wt-switch",
    )) {
      expect(input.getAttribute("name"), input.outerHTML).toMatch(/^[a-zA-Z]+(-[a-z]+)?$/);
    }
  });

  it("saves every field of an edit, then closes and reloads the list", async () => {
    const api = fakeApi();
    const el = await mount(api);
    await press(el, "edit-c");
    await type(el, "name", "Guest complaint ");
    await type(el, "names-es", "Serious complaint (es)");
    await toggleAction(el, "comp");
    await toggleAction(el, "discount_amount");
    await type(el, "maxPercent", "12,5");
    await type(el, "maxAmount", "45,5");
    await chooseRoles(el, "applyRoles", ["manager", "admin"]);
    await chooseRoles(el, "approverRoles", ["admin"]);
    noteSwitch(el).click();
    await settle(el);
    await press(el, "save-editor");
    expect(api.updateReason).toHaveBeenCalledWith("c", {
      name: "Guest complaint",
      names: { en: "Guest complaint", es: "Serious complaint (es)" },
      kind: "comp",
      actions: ["discount_percent", "discount_amount"],
      maxPercentBp: 1250,
      maxAmount: "45.5",
      applyRoles: ["manager", "admin"],
      approverRoles: ["admin"],
      noteRequired: false,
    });
    expect(modal(el)).toBeNull();
    expect(api.listReasons).toHaveBeenCalledTimes(2);
  });

  it("keeps every change made before the screen redraws", async () => {
    const api = fakeApi();
    const el = await mount(api);
    await press(el, "edit-c");
    actionBox(el, "comp").click();
    actionBox(el, "discount_percent").click();
    actionBox(el, "discount_amount").click();
    for (const [language, text] of [
      ["en", "Complaint about food"],
      ["es", "Serious complaint (es)"],
    ] as const) {
      const input = field(el, `names-${language}`).shadowRoot!.querySelector("input")!;
      input.value = text;
      input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    }
    await settle(el);
    await press(el, "save-editor");
    expect(api.updateReason.mock.calls[0]![1]).toMatchObject({
      actions: ["discount_amount"],
      names: { en: "Complaint about food", es: "Serious complaint (es)" },
    });
  });

  it("creates a reason; blank limits and blank translations are sent as none", async () => {
    const api = fakeApi();
    const el = await mount(api);
    await press(el, "add-reason");
    expect(modal(el)!.getAttribute("heading")).toBe("Add reason");
    await type(el, "name", "Birthday");
    await toggleAction(el, "comp");
    await press(el, "save-editor");
    expect(api.createReason).toHaveBeenCalledWith({
      name: "Birthday",
      names: {},
      kind: "comp",
      actions: ["comp"],
      maxPercentBp: null,
      maxAmount: null,
      applyRoles: ["manager", "admin"],
      approverRoles: ["manager", "admin"],
      noteRequired: false,
    });
    expect(modal(el)).toBeNull();
  });

  it("keeps a translation in a language the venue no longer offers", async () => {
    setContentLanguages({ defaultLanguage: "en", languages: ["en"] });
    const api = fakeApi();
    const el = await mount(api);
    await press(el, "edit-c");
    expect(el.shadowRoot!.querySelector('[name="names-es"]')).toBeNull();
    await type(el, "name", "Edited complaint");
    await press(el, "save-editor");
    expect(api.updateReason.mock.calls[0]![1].names).toEqual({
      en: "Guest complaint",
      es: "Guest complaint (es)",
    });
  });

  it("explains an invalid submission beside each field and in one message above Save, keeping the values", async () => {
    const api = fakeApi();
    const el = await mount(api);
    await press(el, "add-reason");
    await type(el, "maxPercent", "150");
    await type(el, "maxAmount", "12.345");
    await chooseRoles(el, "approverRoles", []);
    await press(el, "save-editor");
    expect(api.createReason).not.toHaveBeenCalled();
    const expected = {
      name: "Enter a name.",
      actions: "Choose at least one action.",
      maxPercent: "Enter a percentage above 0 and up to 100, with at most two decimals.",
      maxAmount: "Enter an amount above 0 with at most two decimals, such as 30.00.",
      approverRoles: "Choose at least one role.",
    };
    expect(await bottom(el)).toBe(FIX_FIELDS);
    for (const [key, message] of Object.entries(expected)) {
      expect(besideField(el, key), key).toBe(message);
    }
    expect(field(el, "maxPercent").value).toBe("150");
    expect(modal(el)).not.toBeNull();
  });

  it.each([
    ["maxPercent", "abc", "Enter a percentage above 0 and up to 100, with at most two decimals."],
    ["maxPercent", "0", "Enter a percentage above 0 and up to 100, with at most two decimals."],
    ["maxAmount", "abc", "Enter an amount above 0 with at most two decimals, such as 30.00."],
    ["maxAmount", "0", "Enter an amount above 0 with at most two decimals, such as 30.00."],
    ["maxAmount", "0,00", "Enter an amount above 0 with at most two decimals, such as 30.00."],
  ])("refuses %s %j before sending anything", async (name, value, message) => {
    const api = fakeApi();
    const el = await mount(api);
    await press(el, "edit-c");
    await type(el, name, value);
    await press(el, "save-editor");
    expect(besideField(el, name)).toBe(message);
    expect(api.updateReason).not.toHaveBeenCalled();
  });

  it("sends a whole number without decimals or leading zeros, as the route reads it", async () => {
    const api = fakeApi();
    const el = await mount(api);
    await press(el, "edit-d");
    await type(el, "maxPercent", "7");
    await type(el, "maxAmount", "030");
    await press(el, "save-editor");
    expect(api.updateReason.mock.calls[0]![1]).toMatchObject({
      maxPercentBp: 700,
      maxAmount: "30",
    });
  });

  it("opens a reason with no limits with both limit fields empty", async () => {
    const el = await mount(
      fakeApi({ listReasons: vi.fn().mockResolvedValue([{ ...complaint, maxAmount: null }]) }),
    );
    await press(el, "edit-c");
    expect(field(el, "maxPercent").value).toBe("");
    expect(field(el, "maxAmount").value).toBe("");
  });

  it("sends one save while it is in flight, and Escape does not close the editor meanwhile", async () => {
    let finish!: (value: AdjustmentReason) => void;
    const api = fakeApi({
      updateReason: vi.fn(() => new Promise<AdjustmentReason>((resolve) => (finish = resolve))),
    });
    const el = await mount(api);
    await press(el, "edit-c");
    field(el, "name").focus();
    await type(el, "name", "Edited complaint");
    await press(el, "save-editor");
    const save = find(el, '[data-test="save-editor"]') as HTMLElement & { disabled: boolean };
    expect(save.disabled).toBe(true);
    save.click();
    await settle(el);
    await userEvent.keyboard("{Escape}");
    await settle(el);
    expect(modal(el)).not.toBeNull();
    expect(api.updateReason).toHaveBeenCalledTimes(1);
    finish(complaint);
    await settle(el);
    expect(modal(el)).toBeNull();
  });

  it("clears a field's error once the field is corrected and saved", async () => {
    const api = fakeApi();
    const el = await mount(api);
    await press(el, "add-reason");
    await type(el, "names-en", "Birthday guest");
    await press(el, "save-editor");
    expect(besideField(el, "name")).toBe("Enter a name.");
    await type(el, "name", "Birthday");
    await toggleAction(el, "comp");
    await press(el, "save-editor");
    expect(api.createReason).toHaveBeenCalledTimes(1);
  });

  it("puts the server's refusal of a field beside that field, and says so above Save", async () => {
    const el = await mount(
      fakeApi({
        updateReason: vi.fn().mockRejectedValue({
          code: "management.request_invalid",
          params: { field: "maxPercentBp" },
        }),
      }),
    );
    await press(el, "edit-c");
    await type(el, "name", "Edited complaint");
    await press(el, "save-editor");
    const message = "Enter a percentage above 0 and up to 100, with at most two decimals.";
    expect(besideField(el, "maxPercent")).toBe(message);
    expect(await bottom(el)).toBe(FIX_FIELDS);
    expect(modal(el)).not.toBeNull();
  });

  it.each([
    ["management.request_invalid", "names", "Check the names in each language."],
    ["management.request_invalid", "applyRoles", "Choose at least one role."],
    ["management.request_invalid", "approverRoles", "Choose at least one role."],
    ["management.request_invalid", "kind", "Choose Void or Comp."],
    ["management.request_invalid", "noteRequired", "Choose whether staff must write a note."],
    ["adjustment_reason.invalid", "name", "Enter a name."],
    ["adjustment_reason.invalid", "names", "Check the names in each language."],
    ["adjustment_reason.invalid", "applyRoles", "Choose at least one role."],
    ["adjustment_reason.invalid", "approverRoles", "Choose at least one role."],
  ])("puts the %s refusal of %s beside it", async (code, fieldName, message) => {
    const el = await mount(
      fakeApi({
        updateReason: vi.fn().mockRejectedValue({ code, params: { field: fieldName } }),
      }),
    );
    await press(el, "edit-c");
    await type(el, "name", "Edited complaint");
    await press(el, "save-editor");
    expect(besideField(el, fieldName)).toBe(message);
    expect(await bottom(el)).toBe(FIX_FIELDS);
    expect(button(el, "save-editor").disabled).toBe(false);
  });

  it("shows a name already in use beside the name", async () => {
    const el = await mount(
      fakeApi({
        createReason: vi.fn().mockRejectedValue({
          code: "adjustment_reason.name_taken",
          params: { name: "Complaint" },
        }),
      }),
    );
    await press(el, "add-reason");
    await type(el, "name", "Complaint");
    await toggleAction(el, "comp");
    await press(el, "save-editor");
    expect(besideField(el, "name")).toBe("Another reason already has this name");
    expect(await bottom(el)).toBe(FIX_FIELDS);
    expect(button(el, "save-editor").disabled).toBe(false);
    expect(modal(el)).not.toBeNull();
  });

  it("explains any other refusal above Save and keeps the editor open", async () => {
    const el = await mount(
      fakeApi({
        updateReason: vi
          .fn()
          .mockRejectedValue({ code: "adjustment_reason.not_found", params: { reasonId: "c" } }),
      }),
    );
    await press(el, "edit-c");
    await type(el, "name", "Edited complaint");
    await press(el, "save-editor");
    expect(await bottom(el)).toBe("That reason could not be found. It may have been removed");
    expect(modal(el)).not.toBeNull();
  });

  it("closes a saved editor when refreshing the list fails, and says the list could not load", async () => {
    const api = fakeApi({
      listReasons: vi.fn().mockResolvedValueOnce(reasons).mockRejectedValue({ code: "x" }),
    });
    const el = await mount(api);
    await press(el, "edit-c");
    await type(el, "name", "Edited complaint");
    await press(el, "save-editor");
    expect(api.updateReason).toHaveBeenCalledTimes(1);
    expect(modal(el)).toBeNull();
    expect(alert(el)).toBe("The adjustment reasons could not be loaded.");
  });

  it("closes on Cancel without saving", async () => {
    const api = fakeApi();
    const el = await mount(api);
    await press(el, "edit-c");
    await press(el, "cancel-editor");
    expect(modal(el)).toBeNull();
    const menu = table(el).shadowRoot!.activeElement;
    expect(menu?.tagName).toBe("WT-ROW-ACTIONS");
    expect(menu?.getAttribute("label")).toBe("Actions: Complaint");
    expect(api.updateReason).not.toHaveBeenCalled();
  });

  it("fills the limits with the dashboard's decimal mark, and sends them back unchanged", async () => {
    setLocale("es");
    const api = fakeApi({
      listReasons: vi
        .fn()
        .mockResolvedValue([{ ...complaint, actions: ["discount_percent"], maxPercentBp: 1250 }]),
    });
    const el = await mount(api);
    await press(el, "edit-c");
    expect(field(el, "maxPercent").value).toBe("12,5");
    expect(field(el, "maxAmount").value).toBe("30,00");
    await type(el, "name", "Edited complaint");
    await press(el, "save-editor");
    expect(api.updateReason.mock.calls[0]![1]).toMatchObject({
      maxPercentBp: 1250,
      maxAmount: "30.00",
    });
  });

  it.each([
    ["en", "Most off one bill", "30.00", "before"],
    ["es", ES["adjustments.field.max_amount"], "30,00", "after"],
  ])(
    "shows the %s limit on a bill as a money field, the euro sign in it and not in its label",
    async (locale, label, value, side) => {
      setLocale(locale);
      const el = await mount(fakeApi());
      await press(el, "edit-c");
      const money = field(el, "maxAmount") as Named & {
        label: string;
        updateComplete: Promise<unknown>;
      };
      await money.updateComplete;
      expect(money.tagName).toBe("WT-PRICE-INPUT");
      expect(money.label).toBe(label);
      expect(money.value).toBe(value);
      const sign = money.shadowRoot!.querySelector("[part=currency]");
      expect(sign?.textContent).toBe("€");
      expect(money.shadowRoot!.querySelector("button")).toBeNull();
      const amount = money.shadowRoot!.querySelector("[part=amount]")!;
      const box = amount.getBoundingClientRect();
      const signLeft = sign!.getBoundingClientRect().left;
      expect(signLeft < box.left + box.width / 2 ? "before" : "after").toBe(side);
      const described = (amount.getAttribute("aria-describedby") ?? "")
        .split(" ")
        .map((id) => money.shadowRoot!.getElementById(id)?.textContent?.trim());
      expect(described).toContain(
        locale === "en"
          ? "The venue's own amount. Above it, someone who can approve it is asked."
          : ES["adjustments.field.max_amount_hint"],
      );
    },
  );

  it("closes on Escape without saving", async () => {
    const api = fakeApi();
    const el = await mount(api);
    await press(el, "edit-c");
    field(el, "name").focus();
    // Chromium delivers the native dialog's close event with the next animation frame, which can
    // come after the key press resolves and after `settle`.
    const closed = new Promise<void>((resolve) =>
      modal(el)!.addEventListener("wt-close", () => resolve(), { once: true }),
    );
    await userEvent.keyboard("{Escape}");
    await closed;
    await settle(el);
    expect(modal(el)).toBeNull();
    expect(api.updateReason).not.toHaveBeenCalled();
  });

  it("saves when Enter is pressed in a text field", async () => {
    const api = fakeApi();
    const el = await mount(api);
    await press(el, "edit-c");
    await type(el, "name", "Edited complaint");
    const input = field(el, "name").shadowRoot!.querySelector("input")!;
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true }),
    );
    await settle(el);
    expect(api.updateReason).toHaveBeenCalledTimes(1);
  });
});

describe("the editor's messages", () => {
  it("says nothing and keeps Save working before the first press, even with a field wrong", async () => {
    const el = await mount(fakeApi());
    await press(el, "add-reason");
    await type(el, "maxPercent", "150");
    for (const key of ["name", "actions", "maxPercent"]) expect(besideField(el, key), key).toBe("");
    expect(await bottom(el)).toBe("");
    expect(button(el, "save-editor").disabled).toBe(false);
    expect(el.shadowRoot!.querySelector("wt-form-error-summary")).toBeNull();
  });

  it("marks the fields on a failed press, says so above Save, focuses the first and holds Save", async () => {
    const el = await mount(fakeApi());
    await press(el, "add-reason");
    await type(el, "names-en", "Birthday guest");
    await press(el, "save-editor");
    expect(besideField(el, "name")).toBe("Enter a name.");
    expect(besideField(el, "actions")).toBe("Choose at least one action.");
    expect(actionBox(el, "comp").getAttribute("aria-invalid")).toBe("true");
    expect(await bottom(el)).toBe(FIX_FIELDS);
    expect(el.shadowRoot!.activeElement).toBe(field(el, "name"));
    expect(button(el, "save-editor").disabled).toBe(true);
    expect(el.shadowRoot!.querySelector("wt-form-error-summary")).toBeNull();
  });

  it("focuses the first action when the actions are the first thing wrong", async () => {
    const el = await mount(fakeApi());
    await press(el, "edit-c");
    await toggleAction(el, "comp");
    await toggleAction(el, "discount_percent");
    await press(el, "save-editor");
    expect(el.shadowRoot!.activeElement).toBe(actionBox(el, "comp"));
  });

  it("re-checks on every change: fixing every field brings Save back, breaking one holds it again", async () => {
    const api = fakeApi();
    const el = await mount(api);
    await press(el, "add-reason");
    await type(el, "names-en", "Birthday guest");
    await press(el, "save-editor");
    await type(el, "name", "Birthday");
    expect(besideField(el, "name")).toBe("");
    expect(await bottom(el)).toBe(FIX_FIELDS);
    expect(button(el, "save-editor").disabled).toBe(true);
    await toggleAction(el, "comp");
    expect(besideField(el, "actions")).toBe("");
    expect(actionBox(el, "comp").getAttribute("aria-invalid")).toBe("false");
    expect(await bottom(el)).toBe("");
    expect(button(el, "save-editor").disabled).toBe(false);
    await type(el, "maxPercent", "150");
    expect(besideField(el, "maxPercent")).toBe(
      "Enter a percentage above 0 and up to 100, with at most two decimals.",
    );
    expect(await bottom(el)).toBe(FIX_FIELDS);
    expect(button(el, "save-editor").disabled).toBe(true);
    await type(el, "maxPercent", "100");
    expect(button(el, "save-editor").disabled).toBe(false);
    await press(el, "save-editor");
    expect(api.createReason).toHaveBeenCalledTimes(1);
  });

  it("keeps Save working after the server refuses a field, and keeps the refusal until that field changes", async () => {
    const el = await mount(
      fakeApi({
        updateReason: vi.fn().mockRejectedValue({
          code: "management.request_invalid",
          params: { field: "maxPercentBp" },
        }),
      }),
    );
    await press(el, "edit-d");
    await type(el, "name", "Edited complaint");
    await press(el, "save-editor");
    expect(button(el, "save-editor").disabled).toBe(false);
    expect(el.shadowRoot!.activeElement).toBe(field(el, "maxPercent"));
    await type(el, "name", "Complaints");
    expect(besideField(el, "maxPercent")).toBe(
      "Enter a percentage above 0 and up to 100, with at most two decimals.",
    );
    expect(button(el, "save-editor").disabled).toBe(false);
    await type(el, "maxPercent", "20");
    expect(besideField(el, "maxPercent")).toBe("");
    expect(await bottom(el)).toBe("");
    expect(button(el, "save-editor").disabled).toBe(false);
  });

  it("marks every name in the languages when the server refuses the names", async () => {
    const el = await mount(
      fakeApi({
        updateReason: vi
          .fn()
          .mockRejectedValue({ code: "adjustment_reason.invalid", params: { field: "names" } }),
      }),
    );
    await press(el, "edit-c");
    await type(el, "name", "Edited complaint");
    await press(el, "save-editor");
    expect(el.shadowRoot!.activeElement).toBe(field(el, "names-en"));
    await type(el, "names-es", "Serious complaint (es)");
    expect(besideField(el, "names")).toBe("");
    expect(button(el, "save-editor").disabled).toBe(false);
  });

  it("says a refusal that names no field above Save and keeps Save working, until the next press", async () => {
    const api = fakeApi({
      updateReason: vi.fn().mockRejectedValueOnce({ code: "server.internal" }),
    });
    const el = await mount(api);
    await press(el, "edit-c");
    await type(el, "name", "Edited complaint");
    await press(el, "save-editor");
    expect(await bottom(el)).toBe("Something went wrong, try again");
    expect(button(el, "save-editor").disabled).toBe(false);
    for (const key of ["name", "actions", "maxPercent", "maxAmount"]) {
      expect(besideField(el, key), key).toBe("");
    }
    await type(el, "name", "");
    expect(await bottom(el)).toBe(`Something went wrong, try again ${FIX_FIELDS}`);
    await press(el, "save-editor");
    expect(await bottom(el)).toBe(FIX_FIELDS);
    await type(el, "name", "Complaint corrected");
    await press(el, "save-editor");
    expect(api.updateReason).toHaveBeenCalledTimes(2);
    expect(modal(el)).toBeNull();
  });

  it("starts again when the editor is reopened", async () => {
    const el = await mount(
      fakeApi({ updateReason: vi.fn().mockRejectedValue({ code: "server.internal" }) }),
    );
    await press(el, "add-reason");
    await type(el, "names-en", "Birthday guest");
    await press(el, "save-editor");
    await press(el, "cancel-editor");
    await press(el, "add-reason");
    expect(besideField(el, "name")).toBe("");
    expect(await bottom(el)).toBe("");
    expect(button(el, "save-editor").disabled).toBe(true);
    await press(el, "cancel-editor");
    await press(el, "edit-c");
    await type(el, "name", "Edited complaint");
    await press(el, "save-editor");
    expect(await bottom(el)).toBe("Something went wrong, try again");
    await press(el, "cancel-editor");
    await press(el, "edit-c");
    expect(await bottom(el)).toBe("");
  });

  it("says it in Spanish when the dashboard does", async () => {
    setLocale("es");
    const el = await mount(fakeApi());
    await press(el, "add-reason");
    await type(el, "names-en", "Birthday guest");
    await press(el, "save-editor");
    expect(await bottom(el)).toBe(ES["adjustments.fix_fields"]);
  });
});

describe("disabling", () => {
  const menuFocused = (el: AdjustmentReasonsScreen) =>
    table(el).shadowRoot!.activeElement?.getAttribute("label");

  it.each([
    {
      locale: "en",
      action: "Disable",
      heading: "Disable reason",
      body: "Staff will no longer be offered Complaint. It stays in the list as disabled.",
      filter: ["All reasons", "Active", "Disabled"],
    },
    {
      locale: "es",
      action: ES["adjustments.disable"],
      heading: ES["adjustments.disable_heading"],
      body: tf("adjustments.disable_explained", { name: "Complaint" }, "es"),
      filter: [ES["adjustments.filter_all"], ES["adjustments.active"], ES["adjustments.disabled"]],
    },
  ])(
    "in $locale, offers Disable and confirms it",
    async ({ locale, action, heading, body, filter }) => {
      setLocale(locale);
      const el = await mount(fakeApi());
      expect(find(el, '[data-test="deactivate-c"]')!.textContent!.trim()).toBe(action);
      const status = table(el).shadowRoot!.querySelector<
        HTMLElement & { options: { label: string }[] }
      >('wt-combobox[data-filter="status"]')!;
      expect(status.options.map((option) => option.label)).toEqual(filter);
      await press(el, "deactivate-c");
      const modal = find(el, "wt-modal")!;
      expect(modal.getAttribute("heading")).toBe(heading);
      expect(modal.textContent).toContain(body);
      expect(find(el, '[data-test="confirm-deactivate"]')!.textContent!.trim()).toBe(action);
    },
  );

  it("moves focus to the menu of the row that takes the deactivated one's place", async () => {
    const api = fakeApi({
      listReasons: vi
        .fn()
        .mockResolvedValueOnce(reasons)
        .mockResolvedValue([entryError, employee, { ...complaint, active: false }, retired]),
    });
    const el = await mount(api);
    await press(el, "deactivate-c");
    await press(el, "confirm-deactivate");
    expect(rowKeys(el)).toEqual(["e", "d"]);
    expect(menuFocused(el)).toBe("Actions: Employee discount");
  });

  it("moves focus to the new last row when the last row is deactivated", async () => {
    const api = fakeApi({
      listReasons: vi
        .fn()
        .mockResolvedValueOnce(reasons)
        .mockResolvedValue([entryError, complaint, { ...employee, active: false }, retired]),
    });
    const el = await mount(api);
    await press(el, "deactivate-d");
    await press(el, "confirm-deactivate");
    expect(menuFocused(el)).toBe("Actions: Complaint");
  });

  it("moves focus to Add reason when no active reason remains", async () => {
    const api = fakeApi({
      listReasons: vi
        .fn()
        .mockResolvedValueOnce([complaint])
        .mockResolvedValue([{ ...complaint, active: false }]),
    });
    const el = await mount(api);
    await press(el, "deactivate-c");
    await press(el, "confirm-deactivate");
    expect(rowKeys(el)).toEqual([]);
    const add = el.shadowRoot!.querySelector('[data-test="add-reason"]');
    expect(el.shadowRoot!.activeElement).toBe(add);
  });

  it("says what disabling does before it acts, then disables and reloads", async () => {
    const api = fakeApi();
    const el = await mount(api);
    await press(el, "deactivate-c");
    expect(api.deactivateReason).not.toHaveBeenCalled();
    expect(modal(el)!.textContent).toContain(
      "Staff will no longer be offered Complaint. It stays in the list as disabled.",
    );
    await press(el, "confirm-deactivate");
    expect(api.deactivateReason).toHaveBeenCalledWith("c");
    expect(modal(el)).toBeNull();
    expect(api.listReasons).toHaveBeenCalledTimes(2);
  });

  it("keeps the confirmation open and explains a refusal", async () => {
    const el = await mount(
      fakeApi({ deactivateReason: vi.fn().mockRejectedValue({ code: "server.internal" }) }),
    );
    await press(el, "deactivate-c");
    await press(el, "confirm-deactivate");
    expect(modal(el)).not.toBeNull();
    expect(await bottom(el)).toBe("Something went wrong, try again");
    expect(button(el, "confirm-deactivate").disabled).toBe(false);
  });

  it.each([
    [false, "A venue keeps at least one Void reason."],
    [true, "A venue keeps at least one Void reason that asks for a note."],
  ] as const)(
    "keeps the confirmation open and says void_required (withNote=%s)",
    async (withNote, message) => {
      const api = fakeApi({
        deactivateReason: vi
          .fn()
          .mockRejectedValue({ code: "adjustment_reason.void_required", params: { withNote } }),
      });
      const el = await mount(api);
      await press(el, "deactivate-e");
      await press(el, "confirm-deactivate");
      expect(api.deactivateReason).toHaveBeenCalledWith("e");
      expect(modal(el)).not.toBeNull();
      expect(await bottom(el)).toBe(message);
    },
  );
});

describe("the bill comp limit", () => {
  const LIMIT_INVALID = "Enter an amount above 0 with at most two decimals, such as 40.00.";
  const NO_ROLES = "Choose at least one role.";
  const limit = (el: AdjustmentReasonsScreen) => field(el, "maxBillComp");
  const section = (el: AdjustmentReasonsScreen) =>
    el.shadowRoot!.querySelector<HTMLElement>('[data-test="limit"]')!;
  const limitBottom = (el: AdjustmentReasonsScreen) =>
    section(el)
      .querySelector("wt-form-actions")!
      .shadowRoot!.querySelector("[data-error]")
      ?.textContent?.trim() ?? "";
  const limitAlert = (el: AdjustmentReasonsScreen) =>
    el.shadowRoot!.querySelector('[data-test="limit-alert"]')?.textContent?.trim() ?? "";
  const saved = (el: AdjustmentReasonsScreen) =>
    el.shadowRoot!.querySelector('[data-test="limit-saved"]')?.textContent?.trim() ?? "";
  const withLimit = (
    maxBillComp: string | null,
    over: Record<string, unknown> = {},
    billApproverRoles: string[] = ["manager", "admin"],
  ) =>
    fakeApi({
      getSettings: vi.fn().mockResolvedValue({ maxBillComp, billApproverRoles }),
      ...over,
    });
  const body = (maxBillComp: string | null, billApproverRoles = ["manager", "admin"]) => ({
    maxBillComp,
    billApproverRoles,
  });

  it.each([
    {
      locale: "en",
      heading: "Limit on a bill's comps",
      label: "Most comped on one bill",
      placeholder: "No limit",
      hint: "Every comp on the bill counts, whatever its reason. Above it, someone on the next list enters their PIN.",
      roles: "Who can approve past it",
      value: "40.00",
      chosen: "Manager, Admin",
      everyone: "Everyone",
      save: "Save limit",
    },
    {
      locale: "es",
      heading: ES["adjustments.limit.heading"],
      label: ES["adjustments.limit.field"],
      placeholder: ES["adjustments.no_limit"],
      hint: ES["adjustments.limit.hint"],
      roles: ES["adjustments.limit.approvers"],
      value: "40,00",
      chosen: `${roleName("manager", "es")}, ${roleName("admin", "es")}`,
      everyone: ES["adjustments.everyone"],
      save: ES["adjustments.limit.save"],
    },
  ])(
    "in $locale, shows the saved amount and who can approve past it, labelled and hinted",
    async ({ locale, heading, label, placeholder, hint, roles, value, chosen, everyone, save }) => {
      setLocale(locale);
      const el = await mount(withLimit("40.00"));
      expect(section(el).querySelector("h2")!.textContent!.trim()).toBe(heading);
      const input = limit(el) as Named & {
        label: string;
        placeholder: string;
        hint: string;
        updateComplete: Promise<unknown>;
      };
      await input.updateComplete;
      expect(input.tagName).toBe("WT-PRICE-INPUT");
      expect(input.value).toBe(value);
      expect(input.label).toBe(label);
      expect(input.placeholder).toBe(placeholder);
      expect(input.hint).toBe(hint);
      expect(input.shadowRoot!.querySelector("[part=currency]")).not.toBeNull();
      expect(section(el).querySelector('[data-test="limit-explained"]')).toBeNull();
      const approvers = roleField(el, "billApproverRoles");
      expect(approvers.tagName).toBe("WT-COMBOBOX");
      expect(approvers.multiple).toBe(true);
      expect(approvers.required).toBe(true);
      expect(approvers.label).toBe(roles);
      expect(approvers.values).toEqual(["manager", "admin"]);
      expect(await closedText(el, "billApproverRoles")).toBe(chosen);
      await chooseRoles(el, "billApproverRoles", ["staff", "supervisor", "manager", "admin"]);
      expect(await closedText(el, "billApproverRoles")).toBe(everyone);
      expect(button(el, "save-limit").textContent!.trim()).toBe(save);
    },
  );

  it("shows an empty amount when the venue sets no limit", async () => {
    const el = await mount(withLimit(null));
    expect(limit(el).value).toBe("");
  });

  it("saves €40.00 and Manager, Admin together", async () => {
    const api = withLimit(null, {}, ["admin"]);
    const el = await mount(api);
    await type(el, "maxBillComp", "40");
    await chooseRoles(el, "billApproverRoles", ["admin", "manager"]);
    await press(el, "save-limit");
    expect(api.saveSettings.mock.calls[0]![0]).toEqual({
      maxBillComp: "40.00",
      billApproverRoles: ["manager", "admin"],
    });
    expect(api.getSettings).toHaveBeenCalledTimes(2);
    expect(saved(el)).toBe("Limit saved.");
    expect(limitBottom(el)).toBe("");
  });

  it.each([
    ["40", "40.00"],
    ["12,5", "12.50"],
    ["12.34", "12.34"],
    ["0.01", "0.01"],
    ["007", "7.00"],
    [" 7 ", "7.00"],
  ])("saves %j as %j, keeping the approvers", async (typed, money) => {
    const api = withLimit(null);
    const el = await mount(api);
    await type(el, "maxBillComp", typed);
    await press(el, "save-limit");
    expect(api.saveSettings).toHaveBeenCalledWith(body(money));
  });

  it("clears the amount to no limit", async () => {
    const api = withLimit("40.00");
    const el = await mount(api);
    await type(el, "maxBillComp", "");
    await press(el, "save-limit");
    expect(api.saveSettings).toHaveBeenCalledWith(body(null));
  });

  it("saves a change of approvers alone, with the amount as it was", async () => {
    const api = withLimit("40.00");
    const el = await mount(api);
    await chooseRoles(el, "billApproverRoles", ["supervisor", "manager", "admin"]);
    await press(el, "save-limit");
    expect(api.saveSettings).toHaveBeenCalledWith(
      body("40.00", ["supervisor", "manager", "admin"]),
    );
  });

  it("refuses an empty approver list beside it and above Save, focuses it, and holds Save until it is fixed", async () => {
    const api = withLimit("40.00");
    const el = await mount(api);
    await chooseRoles(el, "billApproverRoles", []);
    await press(el, "save-limit");
    expect(api.saveSettings).not.toHaveBeenCalled();
    expect(besideField(el, "billApproverRoles")).toBe(NO_ROLES);
    expect(besideField(el, "maxBillComp")).toBe("");
    expect(limitBottom(el)).toBe(FIX_FIELDS);
    expect(el.shadowRoot!.activeElement).toBe(field(el, "billApproverRoles"));
    expect(roleTrigger(el, "billApproverRoles").getAttribute("aria-invalid")).toBe("true");
    expect(button(el, "save-limit").disabled).toBe(true);
    await chooseRoles(el, "billApproverRoles", ["admin"]);
    expect(besideField(el, "billApproverRoles")).toBe("");
    expect(button(el, "save-limit").disabled).toBe(false);
    await press(el, "save-limit");
    expect(api.saveSettings).toHaveBeenCalledWith(body("40.00", ["admin"]));
  });

  it("shows the limit the refresh reads after a save", async () => {
    const api = withLimit(null, {
      getSettings: vi
        .fn()
        .mockResolvedValueOnce(body(null))
        .mockResolvedValue(body("25.00", ["admin"])),
    });
    const el = await mount(api);
    await type(el, "maxBillComp", "20");
    await press(el, "save-limit");
    expect(limit(el).value).toBe("25.00");
    expect(roleField(el, "billApproverRoles").values).toEqual(["admin"]);
  });

  it("reads the limit first as the person's own request, and passively after a save", async () => {
    const background = { getSettings: vi.fn().mockResolvedValue(body("15.00")) };
    const api = fakeApi({ background });
    const el = await mount(api);
    expect(api.getSettings).toHaveBeenCalledTimes(1);
    await type(el, "maxBillComp", "16");
    await press(el, "save-limit");
    expect(background.getSettings).toHaveBeenCalledTimes(1);
  });

  it("says nothing and keeps Save working before the first press, even with the value wrong", async () => {
    const el = await mount(withLimit(null));
    await type(el, "maxBillComp", "abc");
    expect(besideField(el, "maxBillComp")).toBe("");
    expect(limitBottom(el)).toBe("");
    expect(button(el, "save-limit").disabled).toBe(false);
  });

  it.each(["0", "0.00", "12.345", "abc", "-5", "1e2", "1234567890"])(
    "refuses %j beside the field and above Save, focuses it, and holds Save until it is fixed",
    async (typed) => {
      const api = withLimit(null);
      const el = await mount(api);
      await type(el, "maxBillComp", typed);
      await press(el, "save-limit");
      expect(api.saveSettings).not.toHaveBeenCalled();
      expect(besideField(el, "maxBillComp")).toBe(LIMIT_INVALID);
      expect(limitBottom(el)).toBe(FIX_FIELDS);
      expect(el.shadowRoot!.activeElement).toBe(limit(el));
      expect(button(el, "save-limit").disabled).toBe(true);
      expect(limit(el).value).toBe(typed);
      await type(el, "maxBillComp", "20");
      expect(besideField(el, "maxBillComp")).toBe("");
      expect(limitBottom(el)).toBe("");
      expect(button(el, "save-limit").disabled).toBe(false);
      await press(el, "save-limit");
      expect(api.saveSettings).toHaveBeenCalledWith(body("20.00"));
    },
  );

  it.each([
    ["maxBillComp", LIMIT_INVALID, "billApproverRoles"],
    ["billApproverRoles", NO_ROLES, "maxBillComp"],
  ])(
    "maps a refusal naming %s to its field, keeps Save working, and clears it on a change",
    async (named, message, other) => {
      const el = await mount(
        withLimit(null, {
          saveSettings: vi.fn().mockRejectedValue({
            code: "management.request_invalid",
            params: { field: named },
          }),
        }),
      );
      await type(el, "maxBillComp", "20");
      await press(el, "save-limit");
      expect(besideField(el, named)).toBe(message);
      expect(besideField(el, other)).toBe("");
      expect(limitBottom(el)).toBe(FIX_FIELDS);
      expect(el.shadowRoot!.activeElement).toBe(field(el, named));
      expect(button(el, "save-limit").disabled).toBe(false);
      expect(saved(el)).toBe("");
      if (named === "maxBillComp") await type(el, "maxBillComp", "25");
      else await chooseRoles(el, "billApproverRoles", ["admin"]);
      expect(besideField(el, named)).toBe("");
      expect(limitBottom(el)).toBe("");
    },
  );

  it("says any other refusal above Save, keeps Save working, and says it until the next press", async () => {
    const api = withLimit(null, {
      saveSettings: vi
        .fn()
        .mockRejectedValueOnce({ code: "server.internal" })
        .mockResolvedValue(body("20.00")),
    });
    const el = await mount(api);
    await type(el, "maxBillComp", "20");
    await press(el, "save-limit");
    expect(limitBottom(el)).toBe("Something went wrong, try again");
    expect(besideField(el, "maxBillComp")).toBe("");
    expect(button(el, "save-limit").disabled).toBe(false);
    await press(el, "save-limit");
    expect(limitBottom(el)).toBe("");
    expect(api.saveSettings).toHaveBeenCalledTimes(2);
  });

  it("treats a failed refresh after a save as a load failure, not a failed save", async () => {
    const api = withLimit(null, {
      getSettings: vi.fn().mockResolvedValueOnce(body(null)).mockRejectedValue({ code: "x" }),
    });
    const el = await mount(api);
    await type(el, "maxBillComp", "20");
    await press(el, "save-limit");
    expect(api.saveSettings).toHaveBeenCalledTimes(1);
    expect(limitBottom(el)).toBe("");
    expect(limitAlert(el)).toBe("The bill's comp limit could not be loaded.");
    expect(alert(el)).toBe("");
    expect(limit(el).value).toBe("20.00");
  });

  it("says the limit could not be loaded, apart from the reasons, and offers no field", async () => {
    const el = await mount(
      withLimit(null, { getSettings: vi.fn().mockRejectedValue({ code: "x" }) }),
    );
    expect(limitAlert(el)).toBe("The bill's comp limit could not be loaded.");
    expect(el.shadowRoot!.querySelector('[data-test="limit-alert"]')!.getAttribute("role")).toBe(
      "alert",
    );
    expect(alert(el)).toBe("");
    expect(el.shadowRoot!.querySelector('[name="maxBillComp"]')).toBeNull();
    expect(el.shadowRoot!.querySelector('[name="billApproverRoles"]')).toBeNull();
    expect(rowKeys(el)).toEqual(["e", "c", "d"]);
  });

  it("sends one save while it is in flight, holding both fields", async () => {
    let finish!: (value: unknown) => void;
    const api = withLimit(null, {
      saveSettings: vi.fn(() => new Promise((resolve) => (finish = resolve))),
    });
    const el = await mount(api);
    await type(el, "maxBillComp", "20");
    await press(el, "save-limit");
    expect(button(el, "save-limit").disabled).toBe(true);
    expect((limit(el) as Named & { disabled: boolean }).disabled).toBe(true);
    expect(roleTrigger(el, "billApproverRoles").disabled).toBe(true);
    await press(el, "save-limit");
    expect(api.saveSettings).toHaveBeenCalledTimes(1);
    finish(body("20.00"));
    await settle(el);
    expect(button(el, "save-limit").disabled).toBe(true);
    expect((limit(el) as Named & { disabled: boolean }).disabled).toBe(false);
    expect(roleTrigger(el, "billApproverRoles").disabled).toBe(false);
  });

  it("saves when Enter is pressed in the amount", async () => {
    const api = withLimit(null);
    const el = await mount(api);
    await type(el, "maxBillComp", "20");
    const input = limit(el).shadowRoot!.querySelector("input")!;
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true }),
    );
    await settle(el);
    expect(api.saveSettings).toHaveBeenCalledWith(body("20.00"));
  });

  it("says nothing of a wrong value typed after a save until Save is pressed again", async () => {
    const el = await mount(withLimit(null));
    await type(el, "maxBillComp", "abc");
    await press(el, "save-limit");
    await type(el, "maxBillComp", "20");
    await press(el, "save-limit");
    await type(el, "maxBillComp", "abc");
    expect(besideField(el, "maxBillComp")).toBe("");
    expect(limitBottom(el)).toBe("");
    expect(button(el, "save-limit").disabled).toBe(false);
  });

  it("drops the could-not-load alert once a later read of the limit succeeds", async () => {
    const api = withLimit(null, {
      getSettings: vi
        .fn()
        .mockResolvedValueOnce(body(null))
        .mockRejectedValueOnce({ code: "x" })
        .mockResolvedValue(body("25.00")),
    });
    const el = await mount(api);
    await type(el, "maxBillComp", "20");
    await press(el, "save-limit");
    expect(limitAlert(el)).toBe("The bill's comp limit could not be loaded.");
    await type(el, "maxBillComp", "25");
    await press(el, "save-limit");
    expect(limitAlert(el)).toBe("");
    expect(el.shadowRoot!.querySelector('[data-test="limit-alert"]')).toBeNull();
  });

  it("drops the saved note once either field changes again", async () => {
    const el = await mount(withLimit(null));
    await type(el, "maxBillComp", "20");
    await press(el, "save-limit");
    expect(saved(el)).toBe("Limit saved.");
    await type(el, "maxBillComp", "25");
    expect(saved(el)).toBe("");
    await press(el, "save-limit");
    expect(saved(el)).toBe("Limit saved.");
    await chooseRoles(el, "billApproverRoles", ["admin"]);
    expect(saved(el)).toBe("");
  });
});

for (const locale of ["en", "es"]) {
  it(`decimal input percentage limits follow ${locale}`, async () => {
    setLocale(locale);
    const api = fakeApi();
    const el = await mount(api);
    await press(el, "edit-d");
    const control = field(el, "maxPercent") as Named & { updateComplete: Promise<unknown> };
    await control.updateComplete;
    const native = control.shadowRoot!.querySelector("input")!;
    for (const separator of [".", ","]) {
      await type(el, "maxPercent", `12${separator}50`);
      await control.updateComplete;
      expect(native.value).toBe(locale === "es" ? "12,50" : "12.50");
    }
    await press(el, "save-editor");
    expect(api.updateReason).toHaveBeenCalledWith(
      "d",
      expect.objectContaining({ maxPercentBp: 1250 }),
    );
  });
}

it("starts the reasons table's toolbar with Filters, opening beside the rows on a wide screen and over the screen on a phone", async () => {
  await expectFiltersFirst(
    async () => table(await mount(fakeApi())),
    () => {
      for (const host of hosts.splice(0)) host.remove();
    },
  );
});

it.each(
  [390, 1280].flatMap((width) =>
    ["en", "es"].flatMap((locale) =>
      ["light", "dark"].map((theme) => [width, locale, theme] as const),
    ),
  ),
)(
  "A462 Customise ends the toolbar without search at %i px (%s, %s)",
  async (width, locale, theme) => {
    const previous = [window.innerWidth, window.innerHeight];
    await page.viewport(width, 844);
    setLocale(locale);
    try {
      const el = await mount(fakeApi());
      el.parentElement!.setAttribute("data-theme", theme);
      el.parentElement!.style.background = "var(--wt-color-bg)";
      el.parentElement!.style.color = "var(--wt-color-text)";
      const list = table(el);
      await vi.waitFor(() => {
        const chooser = list
          .shadowRoot!.querySelector<HTMLElement>(".columns-trigger")!
          .getBoundingClientRect();
        const toolbar = list
          .shadowRoot!.querySelector<HTMLElement>(".table-toolbar")!
          .getBoundingClientRect();
        expect(list.shadowRoot!.querySelector(".table-search")).toBeNull();
        expect(chooser.width).toBeGreaterThan(0);
        expect(chooser.right).toBeCloseTo(toolbar.right, 0);
      });
      const chooser = list.shadowRoot!.querySelector<HTMLButtonElement>(".columns-trigger")!;
      await userEvent.click(chooser);
      await vi.waitFor(() => expect(chooser.getAttribute("aria-expanded")).toBe("true"));
      const dialog = list.shadowRoot!.querySelector("wt-dialog")!;
      await userEvent.click(
        dialog
          .querySelector<HTMLElement>('wt-button[slot="footer"]:last-of-type')!
          .shadowRoot!.querySelector<HTMLButtonElement>("button")!,
      );
      await vi.waitFor(() => expect(chooser.getAttribute("aria-expanded")).toBe("false"));
      expect(list.shadowRoot!.activeElement).toBe(chooser);
      await page.screenshot({
        path: `__screenshots__/a462-task1/reasons-${width}-${locale}-${theme}.png`,
      });
    } finally {
      setLocale("en-GB");
      await page.viewport(previous[0]!, previous[1]!);
    }
  },
);
