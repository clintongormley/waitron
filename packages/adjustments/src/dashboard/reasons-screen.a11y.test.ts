import { afterEach, describe, expect, test, vi } from "vitest";
import { setLocale } from "@waitron/dashboard-kit";
import { setContentLanguages } from "@waitron/ui";
import { cleanup, formMessageOf, host } from "@waitron/ui/src/test-helpers.js";
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
    names: { en: "Keyed by mistake", es: "Error al marcar" },
    actions: ["cancel"],
    maxPercentBp: null,
    maxAmount: null,
    applyRole: "staff",
    approverRole: "supervisor",
    noteRequired: false,
    active: true,
    position: 0,
  },
  {
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
  },
  {
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
    getSettings: vi.fn().mockResolvedValue({ maxBillDiscountBp: 1500 }),
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
  test("the list of active reasons", async () => {
    await screen(theme);
    await expectNoA11yViolations(host);
  });

  test("the list showing inactive reasons", async () => {
    const el = await screen(theme);
    const filter = deep(el, 'select[data-filter="status"]') as HTMLSelectElement;
    filter.value = "";
    filter.dispatchEvent(new Event("change"));
    await settle(el);
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

  test("the editor after an invalid submission", async () => {
    const el = await screen(theme);
    await press(el, "add-reason");
    await press(el, "save-editor");
    expect(el.shadowRoot!.querySelector('[data-field-error="actions"]')).not.toBeNull();
    await expectNoA11yViolations(host);
  });

  test("the editor after a refusal that names no field", async () => {
    const el = await screen(theme, {
      updateReason: vi.fn().mockRejectedValue({ code: "server.internal" }),
    });
    await press(el, "edit-c");
    await press(el, "save-editor");
    const actions = el.shadowRoot!.querySelector("wt-modal")!.querySelector("wt-form-actions")!;
    expect(await formMessageOf(actions)).not.toBeNull();
    await expectNoA11yViolations(host);
  });

  test("the bill discount limit after an invalid submission", async () => {
    const el = await screen(theme);
    const field = deep(el, 'wt-price-input[name="maxBillDiscount"]');
    const input = field.shadowRoot!.querySelector("input")!;
    input.value = "150";
    input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    await press(el, "save-limit");
    expect((field as HTMLElement & { error: string }).error).not.toBe("");
    await expectNoA11yViolations(host);
  });

  test("the bill discount limit just saved", async () => {
    const el = await screen(theme);
    await press(el, "save-limit");
    expect(el.shadowRoot!.querySelector('[data-test="limit-saved"]')).not.toBeNull();
    await expectNoA11yViolations(host);
  });

  test("the bill discount limit that could not be loaded", async () => {
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
