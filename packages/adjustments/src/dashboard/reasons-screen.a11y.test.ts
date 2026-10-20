import { afterEach, describe, expect, test, vi } from "vitest";
import { setLocale } from "@waitron/dashboard-kit";
import { setContentLanguages } from "@waitron/ui";
import { chooseOptions, cleanup, formMessageOf, host } from "@waitron/ui/src/test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "@waitron/ui/src/a11y-helpers.js";
import type { AdjustmentReason, AdjustmentsApi } from "./client.js";
import type { AdjustmentReasonsScreen } from "./reasons-screen.js";
import "./reasons-screen.js";

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  localStorage.clear();
  setContentLanguages({ defaultLanguage: "en", languages: ["en"] });
});

const reasons: AdjustmentReason[] = [
  {
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
    position: 0,
  },
  {
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
    position: 1,
  },
  {
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
    position: 2,
  },
];

async function settle(el: AdjustmentReasonsScreen): Promise<void> {
  for (let i = 0; i < 3; i++) {
    await el.updateComplete;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

async function screen(
  theme: "light" | "dark",
  overrides: Record<string, unknown> = {},
): Promise<AdjustmentReasonsScreen> {
  setLocale("en");
  setContentLanguages({ defaultLanguage: "en", languages: ["en", "es"] });
  await mountThemed("<div></div>", theme);
  const api = {
    listReasons: vi.fn().mockResolvedValue(reasons),
    getSettings: vi
      .fn()
      .mockResolvedValue({ maxBillComp: "15.00", billApproverRoles: ["manager", "admin"] }),
    saveSettings: vi.fn(async (settings: unknown) => settings),
    ...overrides,
  } as Record<string, unknown>;
  api.background = api;
  const el = document.createElement(
    "dashboard-adjustment-reasons-screen",
  ) as AdjustmentReasonsScreen;
  el.api = api as unknown as AdjustmentsApi;
  host.append(el);
  await settle(el);
  return el;
}

function deep(el: AdjustmentReasonsScreen, selector: string): HTMLElement {
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
  const found = search(el.shadowRoot!);
  expect(found, selector).not.toBeNull();
  return found!;
}

async function press(el: AdjustmentReasonsScreen, test: string): Promise<void> {
  const button = deep(el, `[data-test="${test}"]`);
  const menu = button.closest("wt-row-actions");
  if (menu) menu.shadowRoot!.querySelector<HTMLButtonElement>("button")!.click();
  button.click();
  await settle(el);
}

describe.each(["light", "dark"] as const)("adjustment reasons accessibility (%s)", (theme) => {
  test.each(["add-reason", "edit-c"])("quiet and changed reason Save (%s)", async (action) => {
    const el = await screen(theme);
    await press(el, action);
    const save =
      el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=save-editor]")!;
    expect(save.disabled).toBe(true);
    expect(save.variant).toBe("secondary");
    await expectNoA11yViolations(host);
    el.shadowRoot!.querySelector("[name=name]")!.dispatchEvent(
      new CustomEvent("wt-change", { detail: { value: "Edited complaint" } }),
    );
    await settle(el);
    expect(save.disabled).toBe(false);
    expect(save.variant).toBe("primary");
    await expectNoA11yViolations(host);
  });
  test("quiet and changed limit Save", async () => {
    const el = await screen(theme);
    const save =
      el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=save-limit]")!;
    expect(save.disabled).toBe(true);
    expect(save.variant).toBe("secondary");
    await expectNoA11yViolations(host);
    el.shadowRoot!.querySelector("[name=maxBillComp]")!.dispatchEvent(
      new CustomEvent("wt-change", { detail: { value: "20" } }),
    );
    await settle(el);
    expect(save.disabled).toBe(false);
    expect(save.variant).toBe("primary");
    await expectNoA11yViolations(host);
  });
  test("the list", async () => {
    const el = await screen(theme);
    expect(el.shadowRoot!.querySelectorAll("tbody tr[data-reason]")).toHaveLength(3);
    await expectNoA11yViolations(host);
  });

  test("the list with its grips", async () => {
    const el = await screen(theme);
    expect(el.shadowRoot!.querySelectorAll('tbody [data-test^="drag-"]')).toHaveLength(3);
    await expectNoA11yViolations(host);
  });

  test("a grip focused", async () => {
    const el = await screen(theme);
    const grip = el.shadowRoot!.querySelector<HTMLElement>('[data-test="drag-e"]')!;
    grip.focus();
    expect(el.shadowRoot!.activeElement).toBe(grip);
    await expectNoA11yViolations(host);
  });

  test("a search matching nothing", async () => {
    const el = await screen(theme);
    const search = el.shadowRoot!.querySelector("[name=search]")!;
    const input = search.shadowRoot!.querySelector("input")!;
    input.value = "zzz";
    input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    await settle(el);
    expect(el.shadowRoot!.querySelector('[data-test="no-matches"]')).not.toBeNull();
    await expectNoA11yViolations(host);
  });

  test("the list at phone width", async () => {
    const el = await screen(theme);
    host.style.width = "390px";
    await settle(el);
    const wrap = el.shadowRoot!.querySelector<HTMLElement>('[data-test="reasons"]')!;
    expect(wrap.scrollWidth).toBeGreaterThan(wrap.clientWidth);
    await expectNoA11yViolations(host);
  });

  test("the empty list", async () => {
    const el = await screen(theme, { listReasons: vi.fn().mockResolvedValue([]) });
    expect(el.shadowRoot!.querySelector('[data-test="empty"]')).not.toBeNull();
    await expectNoA11yViolations(host);
  });

  test("the open row menu", async () => {
    const el = await screen(theme);
    const menu = deep(el, 'tr[data-reason="c"] wt-row-actions');
    menu.shadowRoot!.querySelector<HTMLButtonElement>("button")!.click();
    await settle(el);
    expect(menu.shadowRoot!.querySelector("button")!.getAttribute("aria-expanded")).toBe("true");
    await expectNoA11yViolations(host);
  });

  test("the list that could not be loaded", async () => {
    await screen(theme, { listReasons: vi.fn().mockRejectedValue({ code: "x" }) });
    await expectNoA11yViolations(host);
  });

  test("the editor with every field", async () => {
    const el = await screen(theme);
    await press(el, "edit-c");
    await expectNoA11yViolations(host);
  });

  test("the Comp form with a role list open", async () => {
    const el = await screen(theme);
    await press(el, "edit-c");
    const list = deep(el, 'wt-combobox[name="approverRoles"]');
    list.shadowRoot!.querySelector<HTMLElement>(".trigger")!.click();
    await settle(el);
    await expectNoA11yViolations(host);
  });

  test("the Comp form after refusing an empty list and Free under an item limit", async () => {
    const el = await screen(theme);
    await press(el, "edit-c");
    await chooseOptions(deep(el, 'wt-combobox[name="applyRoles"]'), []);
    deep(el, '[name="maxPercent"]').dispatchEvent(
      new CustomEvent("wt-change", { detail: { value: "50" } }),
    );
    await settle(el);
    await press(el, "save-editor");
    expect(
      el.shadowRoot!.querySelector<HTMLElement & { error: string }>(
        'wt-combobox[name="applyRoles"]',
      )!.error,
    ).not.toBe("");
    await expectNoA11yViolations(host);
  });

  test("the Void form", async () => {
    const el = await screen(theme);
    await press(el, "edit-e");
    expect(el.shadowRoot!.querySelector('[data-test="void-rule"]')).not.toBeNull();
    await expectNoA11yViolations(host);
  });

  test("the Void form after a void_required refusal", async () => {
    const el = await screen(theme, {
      updateReason: vi
        .fn()
        .mockRejectedValue({ code: "adjustment_reason.void_required", params: { withNote: true } }),
    });
    await press(el, "edit-e");
    deep(el, '[name="name"]').dispatchEvent(
      new CustomEvent("wt-change", { detail: { value: "Wrong key" } }),
    );
    await settle(el);
    await press(el, "save-editor");
    expect(el.shadowRoot!.querySelector('[data-field-error="noteRequired"]')).not.toBeNull();
    await expectNoA11yViolations(host);
  });

  test("the editor after an invalid submission", async () => {
    const el = await screen(theme);
    await press(el, "add-reason");
    deep(el, '[name="names-en"]').dispatchEvent(
      new CustomEvent("wt-change", { detail: { value: "Birthday guest" } }),
    );
    await el.updateComplete;
    await press(el, "save-editor");
    expect(el.shadowRoot!.querySelector('[data-field-error="actions"]')).not.toBeNull();
    await expectNoA11yViolations(host);
  });

  test("the editor after a refusal that names no field", async () => {
    const el = await screen(theme, {
      updateReason: vi.fn().mockRejectedValue({ code: "server.internal" }),
    });
    await press(el, "edit-c");
    deep(el, '[name="name"]').dispatchEvent(
      new CustomEvent("wt-change", { detail: { value: "Edited complaint" } }),
    );
    await el.updateComplete;
    await press(el, "save-editor");
    const actions = el.shadowRoot!.querySelector("wt-modal")!.querySelector("wt-form-actions")!;
    expect(await formMessageOf(actions)).not.toBeNull();
    await expectNoA11yViolations(host);
  });

  test("the bill comp limit after an invalid submission", async () => {
    const el = await screen(theme);
    const field = deep(el, 'wt-price-input[name="maxBillComp"]');
    const input = field.shadowRoot!.querySelector("input")!;
    input.value = "abc";
    input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    const approvers = deep(el, 'wt-combobox[name="billApproverRoles"]');
    approvers.dispatchEvent(new CustomEvent("wt-change", { detail: { values: [] } }));
    await press(el, "save-limit");
    expect((field as HTMLElement & { error: string }).error).not.toBe("");
    expect((approvers as HTMLElement & { error: string }).error).not.toBe("");
    await expectNoA11yViolations(host);
  });

  test("the bill comp limit just saved", async () => {
    const el = await screen(theme);
    deep(el, '[name="maxBillComp"]').dispatchEvent(
      new CustomEvent("wt-change", { detail: { value: "20" } }),
    );
    await el.updateComplete;
    await press(el, "save-limit");
    expect(el.shadowRoot!.querySelector('[data-test="limit-saved"]')).not.toBeNull();
    await expectNoA11yViolations(host);
  });

  test("the bill comp limit that could not be loaded", async () => {
    const el = await screen(theme, { getSettings: vi.fn().mockRejectedValue({ code: "x" }) });
    expect(el.shadowRoot!.querySelector('[data-test="limit-alert"]')).not.toBeNull();
    await expectNoA11yViolations(host);
  });

  test("the deactivation confirmation", async () => {
    const el = await screen(theme);
    await press(el, "deactivate-c");
    await expectNoA11yViolations(host);
  });
});
