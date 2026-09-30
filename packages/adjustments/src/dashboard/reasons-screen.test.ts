import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { setLocale } from "@waitron/dashboard-kit";
import { applyTokens, setContentLanguages } from "@waitron/ui";
import { expectRowMenusOnScreen } from "@waitron/ui/src/test-helpers.js";
import type { AdjustmentReason, AdjustmentsApi } from "./client.js";
import type { AdjustmentReasonsScreen } from "./reasons-screen.js";
import "./reasons-screen.js";

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
  names: { en: "Keyed by mistake", es: "Error al marcar" },
  actions: ["cancel"],
  maxPercentBp: null,
  maxAmount: null,
  applyRole: "staff",
  approverRole: "supervisor",
  noteRequired: false,
  active: true,
  position: 0,
};
const complaint: AdjustmentReason = {
  id: "c",
  name: "Complaint",
  names: { en: "Guest complaint", es: "Queja" },
  actions: ["comp", "discount_percent"],
  maxPercentBp: 5000,
  maxAmount: "30.00",
  applyRole: "supervisor",
  approverRole: "manager",
  noteRequired: true,
  active: true,
  position: 1,
};
const employee: AdjustmentReason = {
  id: "d",
  name: "Employee discount",
  names: {},
  actions: ["discount_percent"],
  maxPercentBp: 3000,
  maxAmount: "20.00",
  applyRole: "supervisor",
  approverRole: "manager",
  noteRequired: false,
  active: true,
  position: 2,
};
const retired: AdjustmentReason = {
  id: "o",
  name: "Old promotion",
  names: {},
  actions: ["discount_amount"],
  maxPercentBp: null,
  maxAmount: "5.00",
  applyRole: "staff",
  approverRole: "manager",
  noteRequired: false,
  active: false,
  position: 3,
};
const reasons = [entryError, complaint, employee, retired];

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
    getSettings: vi.fn().mockResolvedValue({ maxBillDiscountBp: null }),
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
  const select = field(el, name) as unknown as HTMLSelectElement;
  select.value = value;
  select.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
  await settle(el);
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
    `wt-input[name="${key}"], wt-price-input[name="${key}"]`,
  );
  if (input) return input.error ?? "";
  return el.shadowRoot!.querySelector(`[data-field-error="${key}"]`)?.textContent?.trim() ?? "";
}

/** The screen's own alert, outside any form: a list that would not load or an order not saved. */
function alert(el: AdjustmentReasonsScreen): string {
  return el.shadowRoot!.querySelector('[data-test="page-alert"]')?.textContent?.trim() ?? "";
}

/** The open form's one message, shown at the end of the dialog's body. */
function bottom(el: AdjustmentReasonsScreen): string {
  return modal(el)!.shadowRoot!.querySelector(".body [data-error]")?.textContent?.trim() ?? "";
}

function button(el: AdjustmentReasonsScreen, test: string): HTMLElement & { disabled: boolean } {
  return find(el, `[data-test="${test}"]`) as HTMLElement & { disabled: boolean };
}

const FIX_FIELDS = "Correct the highlighted fields to continue.";

describe("the reasons list", () => {
  it("lists the active reasons in their order, with what each allows, its limits and roles", async () => {
    const el = await mount(fakeApi());
    expect(rowKeys(el)).toEqual(["e", "c", "d"]);
    const text = rowText(el, "c");
    expect(text).toContain("Complaint");
    expect(text).not.toContain("Guest complaint");
    expect(text).toContain("Give away");
    expect(text).toContain("Percentage discount");
    expect(text).toContain("Up to 50% off an item");
    expect(text).toContain("Up to €30.00 off a bill");
    expect(text).toContain("Supervisor");
    expect(text).toContain("Manager approves");
    expect(text).toContain("Note required");
    expect(rowText(el, "e")).toContain("No limit");
  });

  it("shows the inactive reasons when the status filter asks for them, without reorder buttons", async () => {
    const el = await mount(fakeApi());
    const filter = table(el).shadowRoot!.querySelector<HTMLSelectElement>(
      'select[data-filter="status"]',
    )!;
    expect(filter.value).toBe("active");
    filter.value = "inactive";
    filter.dispatchEvent(new Event("change"));
    await settle(el);
    expect(rowKeys(el)).toEqual(["o"]);
    expect(rowText(el, "o")).toContain("Inactive");
    expect(find(el, '[data-test="move-up-o"]')).toBeNull();
    expect(find(el, '[data-test="deactivate-o"]')).toBeNull();
    expect(find(el, '[data-test="edit-o"]')).not.toBeNull();
  });

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
    expect(el.shadowRoot!.querySelector("h1")!.textContent).toContain("Motivos de ajuste");
    const text = rowText(el, "c");
    expect(text).toContain("Invitación");
    expect(text).toContain("Hasta un 50% de un artículo");
    expect(text).toContain("Hasta 30,00\u00a0€ de una cuenta");
    expect(text).toContain("Aprueba: Encargado");
  });
});

describe("the reasons list's column chooser", () => {
  type Table = HTMLElement & { updateComplete: Promise<unknown> };
  const chooser = (el: AdjustmentReasonsScreen) =>
    table(el).shadowRoot!.querySelector(".columns-trigger")!.textContent!.trim();
  const choices = (el: AdjustmentReasonsScreen) =>
    [...table(el).shadowRoot!.querySelectorAll<HTMLInputElement>("input[data-column]")].map(
      (box) => [box.dataset.column, box.checked],
    );
  const headers = (el: AdjustmentReasonsScreen) =>
    [...table(el).shadowRoot!.querySelectorAll("thead th")].map((th) => th.textContent!.trim());

  it("offers every column but the name and the row's controls, and remembers a hidden one", async () => {
    const el = await mount(fakeApi());
    expect(chooser(el)).toBe("Columns");
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
    expect(chooser(el)).toBe("Columnas");
  });
});

describe("at phone width", () => {
  const longName = "Queja del comensal por el tiempo de espera en la terraza";

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
    for (const name of ["applyRole", "approverRole"]) {
      const select = field(el, name) as unknown as HTMLSelectElement;
      expect([...select.options].map((option) => option.value)).toEqual(roles);
    }
    expect(field(el, "applyRole").value).toBe("supervisor");
    expect(field(el, "approverRole").value).toBe("manager");
  });

  it.each(["en", "es"])("keeps role seniority separate from name order in %s", async (locale) => {
    setLocale(locale);
    const api = fakeApi();
    const el = await mount(api);
    await press(el, "edit-c");
    await choose(el, "applyRole", "manager");
    await choose(el, "approverRole", "supervisor");
    await press(el, "save-editor");
    expect(api.updateReason).not.toHaveBeenCalled();
    expect(field(el, "approverRole").getAttribute("aria-invalid")).toBe("true");
    await choose(el, "approverRole", "admin");
    await press(el, "save-editor");
    expect(api.updateReason.mock.calls[0]![1]).toMatchObject({
      applyRole: "manager",
      approverRole: "admin",
    });
    expect(modal(el)).toBeNull();
  });

  it("opens with every field of the reason, each with a semantic name", async () => {
    const el = await mount(fakeApi());
    await press(el, "edit-c");
    expect(modal(el)!.getAttribute("heading")).toBe("Edit reason");
    expect(field(el, "name").value).toBe("Complaint");
    expect(field(el, "names-en").value).toBe("Guest complaint");
    expect(field(el, "names-es").value).toBe("Queja");
    expect(actionBox(el, "cancel").checked).toBe(false);
    expect(actionBox(el, "comp").checked).toBe(true);
    expect(actionBox(el, "discount_percent").checked).toBe(true);
    expect(actionBox(el, "discount_amount").checked).toBe(false);
    expect(field(el, "maxPercent").value).toBe("50");
    expect(field(el, "maxAmount").value).toBe("30.00");
    expect((field(el, "applyRole") as unknown as HTMLSelectElement).value).toBe("supervisor");
    expect((field(el, "approverRole") as unknown as HTMLSelectElement).value).toBe("manager");
    expect(noteSwitch(el).checked).toBe(true);
    for (const input of modal(el)!.querySelectorAll(
      "wt-input, wt-price-input, select, input, wt-switch",
    )) {
      expect(input.getAttribute("name"), input.outerHTML).toMatch(/^[a-zA-Z]+(-[a-z]+)?$/);
    }
  });

  it("saves every field of an edit, then closes and reloads the list", async () => {
    const api = fakeApi();
    const el = await mount(api);
    await press(el, "edit-c");
    await type(el, "name", "Guest complaint ");
    await type(el, "names-es", "Queja grave");
    await toggleAction(el, "comp");
    await toggleAction(el, "discount_amount");
    await type(el, "maxPercent", "12,5");
    await type(el, "maxAmount", "45,5");
    await choose(el, "applyRole", "manager");
    await choose(el, "approverRole", "admin");
    noteSwitch(el).click();
    await settle(el);
    await press(el, "save-editor");
    expect(api.updateReason).toHaveBeenCalledWith("c", {
      name: "Guest complaint",
      names: { en: "Guest complaint", es: "Queja grave" },
      actions: ["discount_percent", "discount_amount"],
      maxPercentBp: 1250,
      maxAmount: "45.5",
      applyRole: "manager",
      approverRole: "admin",
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
    actionBox(el, "cancel").click();
    for (const [language, text] of [
      ["en", "Complaint about food"],
      ["es", "Queja grave"],
    ] as const) {
      const input = field(el, `names-${language}`).shadowRoot!.querySelector("input")!;
      input.value = text;
      input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    }
    await settle(el);
    await press(el, "save-editor");
    expect(api.updateReason.mock.calls[0]![1]).toMatchObject({
      actions: ["cancel"],
      names: { en: "Complaint about food", es: "Queja grave" },
    });
  });

  it("creates a reason; blank limits and blank translations are sent as none", async () => {
    const api = fakeApi();
    const el = await mount(api);
    await press(el, "add-reason");
    expect(modal(el)!.getAttribute("heading")).toBe("New reason");
    await type(el, "name", "Birthday");
    await toggleAction(el, "comp");
    await press(el, "save-editor");
    expect(api.createReason).toHaveBeenCalledWith({
      name: "Birthday",
      names: {},
      actions: ["comp"],
      maxPercentBp: null,
      maxAmount: null,
      applyRole: "manager",
      approverRole: "manager",
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
    await press(el, "save-editor");
    expect(api.updateReason.mock.calls[0]![1].names).toEqual({
      en: "Guest complaint",
      es: "Queja",
    });
  });

  it("explains an invalid submission beside each field and in one message above Save, keeping the values", async () => {
    const api = fakeApi();
    const el = await mount(api);
    await press(el, "add-reason");
    await type(el, "maxPercent", "150");
    await type(el, "maxAmount", "12.345");
    await choose(el, "approverRole", "staff");
    await press(el, "save-editor");
    expect(api.createReason).not.toHaveBeenCalled();
    const expected = {
      name: "Enter a name.",
      actions: "Choose at least one action.",
      maxPercent: "Enter a percentage above 0 and up to 100, with at most two decimals.",
      maxAmount: "Enter an amount above 0 with at most two decimals, such as 30.00.",
      approverRole: "The approving role must be the same as, or above, the role that applies it.",
    };
    expect(bottom(el)).toBe(FIX_FIELDS);
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
    await press(el, "edit-c");
    await type(el, "maxPercent", "7");
    await type(el, "maxAmount", "030");
    await press(el, "save-editor");
    expect(api.updateReason.mock.calls[0]![1]).toMatchObject({
      maxPercentBp: 700,
      maxAmount: "30",
    });
  });

  it("opens a reason with no limits with both limit fields empty", async () => {
    const el = await mount(fakeApi());
    await press(el, "edit-e");
    expect(field(el, "maxPercent").value).toBe("");
    expect(field(el, "maxAmount").value).toBe("");
    expect((field(el, "applyRole") as unknown as HTMLSelectElement).value).toBe("staff");
    expect((field(el, "approverRole") as unknown as HTMLSelectElement).value).toBe("supervisor");
  });

  it("sends one save while it is in flight, and Escape does not close the editor meanwhile", async () => {
    let finish!: (value: AdjustmentReason) => void;
    const api = fakeApi({
      updateReason: vi.fn(() => new Promise<AdjustmentReason>((resolve) => (finish = resolve))),
    });
    const el = await mount(api);
    await press(el, "edit-c");
    field(el, "name").focus();
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
    await press(el, "save-editor");
    expect(besideField(el, "name")).toBe("Enter a name.");
    await type(el, "name", "Birthday");
    await toggleAction(el, "cancel");
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
    await press(el, "save-editor");
    const message = "Enter a percentage above 0 and up to 100, with at most two decimals.";
    expect(besideField(el, "maxPercent")).toBe(message);
    expect(bottom(el)).toBe(FIX_FIELDS);
    expect(modal(el)).not.toBeNull();
  });

  it.each([
    ["management.request_invalid", "names", "Check the names in each language."],
    ["management.request_invalid", "applyRole", "Choose who may apply this reason."],
    ["management.request_invalid", "noteRequired", "Choose whether staff must write a note."],
    ["adjustment_reason.invalid", "name", "Enter a name."],
    ["adjustment_reason.invalid", "names", "Check the names in each language."],
    [
      "adjustment_reason.invalid",
      "approverRole",
      "The approving role must be the same as, or above, the role that applies it.",
    ],
  ])("puts the %s refusal of %s beside it", async (code, fieldName, message) => {
    const el = await mount(
      fakeApi({
        updateReason: vi.fn().mockRejectedValue({ code, params: { field: fieldName } }),
      }),
    );
    await press(el, "edit-c");
    await press(el, "save-editor");
    expect(besideField(el, fieldName)).toBe(message);
    expect(bottom(el)).toBe(FIX_FIELDS);
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
    expect(besideField(el, "name")).toBe("Another active reason already has this name");
    expect(bottom(el)).toBe(FIX_FIELDS);
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
    await press(el, "save-editor");
    expect(bottom(el)).toBe("That reason could not be found. It may have been removed");
    expect(modal(el)).not.toBeNull();
  });

  it("closes a saved editor when refreshing the list fails, and says the list could not load", async () => {
    const api = fakeApi({
      listReasons: vi.fn().mockResolvedValueOnce(reasons).mockRejectedValue({ code: "x" }),
    });
    const el = await mount(api);
    await press(el, "edit-c");
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
      listReasons: vi.fn().mockResolvedValue([{ ...complaint, maxPercentBp: 1250 }]),
    });
    const el = await mount(api);
    await press(el, "edit-c");
    expect(field(el, "maxPercent").value).toBe("12,5");
    expect(field(el, "maxAmount").value).toBe("30,00");
    await press(el, "save-editor");
    expect(api.updateReason.mock.calls[0]![1]).toMatchObject({
      maxPercentBp: 1250,
      maxAmount: "30.00",
    });
  });

  it.each([
    ["en", "Most taken off a bill", "30.00", "before"],
    ["es", "Máximo por cuenta", "30,00", "after"],
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
          ? "Everything this reason takes off one bill, added together. Leave it empty for no limit."
          : "Todo lo que este motivo descuenta de una cuenta, sumado. Déjalo vacío para no poner límite.",
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
    expect(bottom(el)).toBe("");
    expect(button(el, "save-editor").disabled).toBe(false);
    expect(el.shadowRoot!.querySelector("wt-form-error-summary")).toBeNull();
  });

  it("marks the fields on a failed press, says so above Save, focuses the first and holds Save", async () => {
    const el = await mount(fakeApi());
    await press(el, "add-reason");
    await press(el, "save-editor");
    expect(besideField(el, "name")).toBe("Enter a name.");
    expect(besideField(el, "actions")).toBe("Choose at least one action.");
    expect(actionBox(el, "cancel").getAttribute("aria-invalid")).toBe("true");
    expect(bottom(el)).toBe(FIX_FIELDS);
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
    expect(el.shadowRoot!.activeElement).toBe(actionBox(el, "cancel"));
  });

  it("re-checks on every change: fixing every field brings Save back, breaking one holds it again", async () => {
    const api = fakeApi();
    const el = await mount(api);
    await press(el, "add-reason");
    await press(el, "save-editor");
    await type(el, "name", "Birthday");
    expect(besideField(el, "name")).toBe("");
    expect(bottom(el)).toBe(FIX_FIELDS);
    expect(button(el, "save-editor").disabled).toBe(true);
    await toggleAction(el, "comp");
    expect(besideField(el, "actions")).toBe("");
    expect(actionBox(el, "cancel").getAttribute("aria-invalid")).toBe("false");
    expect(bottom(el)).toBe("");
    expect(button(el, "save-editor").disabled).toBe(false);
    await type(el, "maxPercent", "150");
    expect(besideField(el, "maxPercent")).toBe(
      "Enter a percentage above 0 and up to 100, with at most two decimals.",
    );
    expect(bottom(el)).toBe(FIX_FIELDS);
    expect(button(el, "save-editor").disabled).toBe(true);
    await type(el, "maxPercent", "15");
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
    await press(el, "edit-c");
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
    expect(bottom(el)).toBe("");
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
    await press(el, "save-editor");
    expect(el.shadowRoot!.activeElement).toBe(field(el, "names-en"));
    await type(el, "names-es", "Queja grave");
    expect(besideField(el, "names")).toBe("");
    expect(button(el, "save-editor").disabled).toBe(false);
  });

  it("says a refusal that names no field above Save and keeps Save working, until the next press", async () => {
    const api = fakeApi({
      updateReason: vi.fn().mockRejectedValueOnce({ code: "server.internal" }),
    });
    const el = await mount(api);
    await press(el, "edit-c");
    await press(el, "save-editor");
    expect(bottom(el)).toBe("Something went wrong, try again");
    expect(button(el, "save-editor").disabled).toBe(false);
    for (const key of ["name", "actions", "maxPercent", "maxAmount"]) {
      expect(besideField(el, key), key).toBe("");
    }
    await type(el, "name", "");
    expect(bottom(el)).toBe(`Something went wrong, try again ${FIX_FIELDS}`);
    await press(el, "save-editor");
    expect(bottom(el)).toBe(FIX_FIELDS);
    await type(el, "name", "Complaint");
    await press(el, "save-editor");
    expect(api.updateReason).toHaveBeenCalledTimes(2);
    expect(modal(el)).toBeNull();
  });

  it("starts again when the editor is reopened", async () => {
    const el = await mount(
      fakeApi({ updateReason: vi.fn().mockRejectedValue({ code: "server.internal" }) }),
    );
    await press(el, "add-reason");
    await press(el, "save-editor");
    await press(el, "cancel-editor");
    await press(el, "add-reason");
    expect(besideField(el, "name")).toBe("");
    expect(bottom(el)).toBe("");
    expect(button(el, "save-editor").disabled).toBe(false);
    await press(el, "cancel-editor");
    await press(el, "edit-c");
    await press(el, "save-editor");
    expect(bottom(el)).toBe("Something went wrong, try again");
    await press(el, "cancel-editor");
    await press(el, "edit-c");
    expect(bottom(el)).toBe("");
  });

  it("says it in Spanish when the dashboard does", async () => {
    setLocale("es");
    const el = await mount(fakeApi());
    await press(el, "add-reason");
    await press(el, "save-editor");
    expect(bottom(el)).toBe("Corrige los campos marcados para continuar.");
  });
});

describe("deactivating", () => {
  const menuFocused = (el: AdjustmentReasonsScreen) =>
    table(el).shadowRoot!.activeElement?.getAttribute("label");

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

  it("says what deactivating does before it acts, then deactivates and reloads", async () => {
    const api = fakeApi();
    const el = await mount(api);
    await press(el, "deactivate-c");
    expect(api.deactivateReason).not.toHaveBeenCalled();
    expect(modal(el)!.textContent).toContain(
      "Staff will no longer be offered Complaint. It stays in the list as inactive.",
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
    expect(bottom(el)).toBe("Something went wrong, try again");
    expect(button(el, "confirm-deactivate").disabled).toBe(false);
  });
});

describe("the bill discount limit", () => {
  const LIMIT_INVALID = "Enter a percentage above 0 and up to 100, with at most two decimals.";
  const limit = (el: AdjustmentReasonsScreen) => field(el, "maxBillDiscount");
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
  const withLimit = (maxBillDiscountBp: number | null, over: Record<string, unknown> = {}) =>
    fakeApi({ getSettings: vi.fn().mockResolvedValue({ maxBillDiscountBp }), ...over });

  it("shows the saved limit as a percentage, labelled and explained", async () => {
    const el = await mount(withLimit(1250));
    const input = limit(el) as Named & { label: string; hint: string };
    expect(input.value).toBe("12.5");
    expect(input.label).toBe("Largest total discount on one bill");
    expect(input.hint).toBe(
      "Discounts on a bill's items and on the whole bill, added together, as a share of the full price of what is still on the bill. When the person making the change is below a manager, a discount that goes past it, or a cancellation that leaves the bill past it with a larger share than before, needs the PIN of a manager or someone more senior. Give-aways made on this bill are not counted as discount. Leave it empty for no limit.",
    );
    expect(section(el).querySelector("h2")!.textContent!.trim()).toBe(
      "Limit on a bill's discounts",
    );
  });

  it("shows the percentage in a narrow box marked %, the label and help at full width", async () => {
    const el = await mount(withLimit(1250));
    const input = limit(el) as Named & { updateComplete: Promise<unknown> };
    await input.updateComplete;
    expect(input.tagName).toBe("WT-PRICE-INPUT");
    const box = input.shadowRoot!.querySelector("[part=amount]")!;
    const unit = input.shadowRoot!.querySelector("[part=unit]")!;
    expect(unit.textContent!.trim()).toBe("%");
    expect(input.shadowRoot!.querySelector("[part=currency]")).toBeNull();
    const narrow = parseFloat(getComputedStyle(input).getPropertyValue("--wt-price-field-width"));
    expect(box.getBoundingClientRect().width).toBeCloseTo(narrow, 0);
    expect(box.getAttribute("aria-describedby")!.split(" ")).toContain(unit.id);
  });

  it("shows an empty field when the venue sets no limit", async () => {
    const el = await mount(withLimit(null));
    expect(limit(el).value).toBe("");
  });

  it("speaks Spanish, with the Spanish decimal mark, when the dashboard does", async () => {
    setLocale("es");
    const el = await mount(withLimit(1));
    const input = limit(el) as Named & { label: string };
    expect(input.value).toBe("0,01");
    expect(input.label).toBe("Descuento total máximo en una cuenta");
    expect(section(el).querySelector("h2")!.textContent!.trim()).toBe(
      "Límite de descuento por cuenta",
    );
    expect(button(el, "save-limit").textContent!.trim()).toBe("Guardar límite");
  });

  it.each([
    ["15", 1500],
    ["12,5", 1250],
    ["12.34", 1234],
    ["0.01", 1],
    ["100", 10000],
    [" 7 ", 700],
  ])("saves %j as %i basis points, says so, and reads the limit again", async (typed, bp) => {
    const api = withLimit(null);
    const el = await mount(api);
    await type(el, "maxBillDiscount", typed);
    await press(el, "save-limit");
    expect(api.saveSettings).toHaveBeenCalledWith({ maxBillDiscountBp: bp });
    expect(api.getSettings).toHaveBeenCalledTimes(2);
    expect(saved(el)).toBe("Limit saved.");
    expect(limitBottom(el)).toBe("");
  });

  it("saves an emptied field as no limit", async () => {
    const api = withLimit(1250);
    const el = await mount(api);
    await type(el, "maxBillDiscount", "");
    await press(el, "save-limit");
    expect(api.saveSettings).toHaveBeenCalledWith({ maxBillDiscountBp: null });
  });

  it("shows the limit the refresh reads after a save", async () => {
    const api = withLimit(null, {
      getSettings: vi
        .fn()
        .mockResolvedValueOnce({ maxBillDiscountBp: null })
        .mockResolvedValue({ maxBillDiscountBp: 2500 }),
    });
    const el = await mount(api);
    await type(el, "maxBillDiscount", "20");
    await press(el, "save-limit");
    expect(limit(el).value).toBe("25");
  });

  it("reads the limit first as the person's own request, and passively after a save", async () => {
    const background = { getSettings: vi.fn().mockResolvedValue({ maxBillDiscountBp: 1500 }) };
    const api = fakeApi({ background });
    const el = await mount(api);
    expect(api.getSettings).toHaveBeenCalledTimes(1);
    await type(el, "maxBillDiscount", "15");
    await press(el, "save-limit");
    expect(background.getSettings).toHaveBeenCalledTimes(1);
  });

  it("says nothing and keeps Save working before the first press, even with the value wrong", async () => {
    const el = await mount(withLimit(null));
    await type(el, "maxBillDiscount", "abc");
    expect(besideField(el, "maxBillDiscount")).toBe("");
    expect(limitBottom(el)).toBe("");
    expect(button(el, "save-limit").disabled).toBe(false);
  });

  it.each(["0", "0.00", "100.01", "150", "12.345", "abc", "-5", "1e2"])(
    "refuses %j beside the field and above Save, focuses it, and holds Save until it is fixed",
    async (typed) => {
      const api = withLimit(null);
      const el = await mount(api);
      await type(el, "maxBillDiscount", typed);
      await press(el, "save-limit");
      expect(api.saveSettings).not.toHaveBeenCalled();
      expect(besideField(el, "maxBillDiscount")).toBe(LIMIT_INVALID);
      expect(limitBottom(el)).toBe(FIX_FIELDS);
      expect(el.shadowRoot!.activeElement).toBe(limit(el));
      expect(button(el, "save-limit").disabled).toBe(true);
      expect(limit(el).value).toBe(typed);
      await type(el, "maxBillDiscount", "20");
      expect(besideField(el, "maxBillDiscount")).toBe("");
      expect(limitBottom(el)).toBe("");
      expect(button(el, "save-limit").disabled).toBe(false);
      await press(el, "save-limit");
      expect(api.saveSettings).toHaveBeenCalledWith({ maxBillDiscountBp: 2000 });
    },
  );

  it("puts the server's refusal of the limit under the field, keeps Save working, and clears it on a change", async () => {
    const el = await mount(
      withLimit(null, {
        saveSettings: vi.fn().mockRejectedValue({
          code: "management.request_invalid",
          params: { field: "maxBillDiscountBp" },
        }),
      }),
    );
    await type(el, "maxBillDiscount", "20");
    await press(el, "save-limit");
    expect(besideField(el, "maxBillDiscount")).toBe(LIMIT_INVALID);
    expect(limitBottom(el)).toBe(FIX_FIELDS);
    expect(el.shadowRoot!.activeElement).toBe(limit(el));
    expect(button(el, "save-limit").disabled).toBe(false);
    expect(saved(el)).toBe("");
    await type(el, "maxBillDiscount", "25");
    expect(besideField(el, "maxBillDiscount")).toBe("");
    expect(limitBottom(el)).toBe("");
  });

  it("says any other refusal above Save, keeps Save working, and says it until the next press", async () => {
    const api = withLimit(null, {
      saveSettings: vi
        .fn()
        .mockRejectedValueOnce({ code: "server.internal" })
        .mockResolvedValue({ maxBillDiscountBp: 2000 }),
    });
    const el = await mount(api);
    await type(el, "maxBillDiscount", "20");
    await press(el, "save-limit");
    expect(limitBottom(el)).toBe("Something went wrong, try again");
    expect(besideField(el, "maxBillDiscount")).toBe("");
    expect(button(el, "save-limit").disabled).toBe(false);
    await press(el, "save-limit");
    expect(limitBottom(el)).toBe("");
    expect(api.saveSettings).toHaveBeenCalledTimes(2);
  });

  it("treats a failed refresh after a save as a load failure, not a failed save", async () => {
    const api = withLimit(null, {
      getSettings: vi
        .fn()
        .mockResolvedValueOnce({ maxBillDiscountBp: null })
        .mockRejectedValue({ code: "x" }),
    });
    const el = await mount(api);
    await type(el, "maxBillDiscount", "20");
    await press(el, "save-limit");
    expect(api.saveSettings).toHaveBeenCalledTimes(1);
    expect(limitBottom(el)).toBe("");
    expect(limitAlert(el)).toBe("The bill discount limit could not be loaded.");
    expect(alert(el)).toBe("");
    expect(limit(el).value).toBe("20");
  });

  it("says the limit could not be loaded, apart from the reasons, and offers no field", async () => {
    const el = await mount(
      withLimit(null, { getSettings: vi.fn().mockRejectedValue({ code: "x" }) }),
    );
    expect(limitAlert(el)).toBe("The bill discount limit could not be loaded.");
    expect(el.shadowRoot!.querySelector('[data-test="limit-alert"]')!.getAttribute("role")).toBe(
      "alert",
    );
    expect(alert(el)).toBe("");
    expect(el.shadowRoot!.querySelector('[name="maxBillDiscount"]')).toBeNull();
    expect(rowKeys(el)).toEqual(["e", "c", "d"]);
  });

  it("sends one save while it is in flight, holding the field", async () => {
    let finish!: (value: { maxBillDiscountBp: number | null }) => void;
    const api = withLimit(null, {
      saveSettings: vi.fn(() => new Promise((resolve) => (finish = resolve))),
    });
    const el = await mount(api);
    await type(el, "maxBillDiscount", "20");
    await press(el, "save-limit");
    expect(button(el, "save-limit").disabled).toBe(true);
    expect((limit(el) as Named & { disabled: boolean }).disabled).toBe(true);
    await press(el, "save-limit");
    expect(api.saveSettings).toHaveBeenCalledTimes(1);
    finish({ maxBillDiscountBp: 2000 });
    await settle(el);
    expect(button(el, "save-limit").disabled).toBe(false);
  });

  it("saves when Enter is pressed in the field", async () => {
    const api = withLimit(null);
    const el = await mount(api);
    await type(el, "maxBillDiscount", "20");
    const input = limit(el).shadowRoot!.querySelector("input")!;
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true }),
    );
    await settle(el);
    expect(api.saveSettings).toHaveBeenCalledWith({ maxBillDiscountBp: 2000 });
  });

  it("says nothing of a wrong value typed after a save until Save is pressed again", async () => {
    const el = await mount(withLimit(null));
    await type(el, "maxBillDiscount", "abc");
    await press(el, "save-limit");
    await type(el, "maxBillDiscount", "20");
    await press(el, "save-limit");
    await type(el, "maxBillDiscount", "abc");
    expect(besideField(el, "maxBillDiscount")).toBe("");
    expect(limitBottom(el)).toBe("");
    expect(button(el, "save-limit").disabled).toBe(false);
  });

  it("drops the could-not-load alert once a later read of the limit succeeds", async () => {
    const api = withLimit(null, {
      getSettings: vi
        .fn()
        .mockResolvedValueOnce({ maxBillDiscountBp: null })
        .mockRejectedValueOnce({ code: "x" })
        .mockResolvedValue({ maxBillDiscountBp: 2500 }),
    });
    const el = await mount(api);
    await type(el, "maxBillDiscount", "20");
    await press(el, "save-limit");
    expect(limitAlert(el)).toBe("The bill discount limit could not be loaded.");
    await type(el, "maxBillDiscount", "25");
    await press(el, "save-limit");
    expect(limitAlert(el)).toBe("");
    expect(el.shadowRoot!.querySelector('[data-test="limit-alert"]')).toBeNull();
  });

  it("drops the saved note once the field changes again", async () => {
    const el = await mount(withLimit(null));
    await type(el, "maxBillDiscount", "20");
    await press(el, "save-limit");
    expect(saved(el)).toBe("Limit saved.");
    await type(el, "maxBillDiscount", "25");
    expect(saved(el)).toBe("");
  });
});
