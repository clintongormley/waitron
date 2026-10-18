import { afterEach, beforeEach, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { setLocale } from "../i18n/t.js";
import type { AdjustmentChoice, AdjustTarget, TillAdjustmentDialog } from "./adjustment-dialog.js";
import type { AdjustmentReason } from "../api/client.js";
import "./adjustment-dialog.js";

beforeEach(() => setLocale("en"));
afterEach(() => {
  cleanupWidgets();
  setLocale("en");
});
const reason = (
  id: string,
  actions: AdjustmentReason["actions"],
  over: Partial<AdjustmentReason> = {},
): AdjustmentReason => ({
  id,
  name: id,
  actions,
  noteRequired: false,
  maxPercentBp: null,
  maxAmount: null,
  applyRole: "staff",
  approverRole: "manager",
  ...over,
});
const reasons = [
  reason("Free", ["comp"]),
  reason("Percent", ["discount_percent"], { maxPercentBp: 1000 }),
  reason("Amount", ["discount_amount"]),
  reason("Mixed", ["comp", "discount_percent", "discount_amount"], { noteRequired: true }),
  reason("Void", ["cancel"]),
];
const dish: AdjustTarget = {
  lineId: "dish",
  name: "Burger",
  quantity: "3",
  total: "36.00",
  unitTotal: "12.00",
};
const extra: AdjustTarget = {
  lineId: "cheese",
  name: "Cheese",
  quantity: "3",
  total: "6.00",
  unitTotal: null,
  extra: true,
};
async function mount(over: Record<string, unknown> = {}) {
  const { el } = await mountWidget<TillAdjustmentDialog>("till-adjustment-dialog", {
    kind: "comp",
    combined: true,
    target: dish,
    reasons,
    ...over,
  });
  return el;
}
const q = (el: TillAdjustmentDialog, selector: string) =>
  el.shadowRoot!.querySelector<HTMLElement>(selector)!;
async function click(el: TillAdjustmentDialog, selector: string) {
  const element = q(el, selector);
  expect(element).not.toBeNull();
  await userEvent.click(element);
  await el.updateComplete;
}
async function type(el: TillAdjustmentDialog, name: string, value: string) {
  const field = q(el, `[name="${name}"]`) as HTMLElement & { updateComplete: Promise<unknown> };
  expect(field).not.toBeNull();
  await field.updateComplete;
  const input = field.shadowRoot!.querySelector<HTMLInputElement>("input")!;
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  await el.updateComplete;
}
function captures(el: TillAdjustmentDialog) {
  const seen: AdjustmentChoice[] = [];
  el.addEventListener("adjust-preview", (e) =>
    seen.push((e as CustomEvent<AdjustmentChoice>).detail),
  );
  return seen;
}
it("offers every non-cancel reason before choosing its allowed adjustment kind", async () => {
  const el = await mount();
  expect(
    [...el.shadowRoot!.querySelectorAll<HTMLInputElement>('input[name="reason"]')].map(
      (r) => r.value,
    ),
  ).toEqual(["Free", "Percent", "Amount", "Mixed"]);
  expect(q(el, "[data-discount-kind]")).toBeNull();
  expect(q(el, 'wt-input[name="percent"]')).toBeNull();
  expect(q(el, "[data-reasons]").textContent).toContain("10%");
});
it.each([
  ["Free", "comp"],
  ["Percent", "discount_percent"],
  ["Amount", "discount_amount"],
] as const)("auto-selects the only allowed action for %s", async (id, action) => {
  const el = await mount();
  const seen = captures(el);
  await click(el, `input[name="reason"][value="${id}"]`);
  expect(q(el, "[data-discount-kind]")).toBeNull();
  if (action !== "comp")
    await type(el, action === "discount_percent" ? "percent" : "amount", "2,50");
  await click(el, "[data-adjust-continue]");
  expect(seen).toEqual([
    {
      action,
      reasonId: id,
      note: null,
      ...(action === "discount_percent"
        ? { percentBp: 250 }
        : action === "discount_amount"
          ? { amount: "2.50" }
          : {}),
    },
  ]);
});
it("reason changes clear an invalid kind and its amount without losing the reason", async () => {
  const el = await mount();
  const seen = captures(el);
  await click(el, 'input[name="reason"][value="Mixed"]');
  expect(
    [...el.shadowRoot!.querySelectorAll<HTMLInputElement>('input[name="discountKind"]')].map(
      (r) => r.value,
    ),
  ).toEqual(["free", "percent", "amount"]);
  await click(el, 'input[name="discountKind"][value="amount"]');
  await type(el, "amount", "4");
  await click(el, 'input[name="reason"][value="Percent"]');
  expect((q(el, 'wt-input[name="percent"]') as HTMLElement & { value: string }).value).toBe("");
  await type(el, "percent", "5");
  await click(el, "[data-adjust-continue]");
  expect(seen).toEqual([
    { action: "discount_percent", reasonId: "Percent", note: null, percentBp: 500 },
  ]);
});
it("can cover two of three whole dishes with their proportional extra shares", async () => {
  const el = await mount();
  const seen = captures(el);
  await click(el, 'input[name="reason"][value="Free"]');
  await type(el, "adjustQuantity", "2");
  await click(el, "[data-adjust-continue]");
  expect(seen).toEqual([{ action: "comp", reasonId: "Free", note: null, quantity: "2" }]);
});
it.each(["0", "4", "1.5", ""])(
  "refuses invalid whole-dish quantity %s before preview",
  async (value) => {
    const el = await mount();
    const seen = captures(el);
    await click(el, 'input[name="reason"][value="Free"]');
    await type(el, "adjustQuantity", value);
    await click(el, "[data-adjust-continue]");
    expect(seen).toEqual([]);
    expect((q(el, '[name="adjustQuantity"]') as HTMLElement & { error: string }).error).not.toBe(
      "",
    );
  },
);
it("offers whole dish or a whole priced extra; switching clears a partial dish quantity", async () => {
  const el = await mount({ target: { ...dish, extras: [extra] } });
  const seen = captures(el);
  await click(el, 'input[name="reason"][value="Free"]');
  await type(el, "adjustQuantity", "2");
  await click(el, 'input[name="adjustTarget"][value="cheese"]');
  expect(q(el, '[name="adjustQuantity"]')).toBeNull();
  expect(q(el, "[data-adjust-scope]").textContent).toContain("Cheese");
  await click(el, "[data-adjust-continue]");
  expect(seen).toEqual([{ action: "comp", reasonId: "Free", note: null, lineId: "cheese" }]);
});
it("hides What without priced extras and the quantity stepper for a weighed dish", async () => {
  const el = await mount({
    target: { ...dish, quantity: "0.750", unitTotal: null, weighed: true },
  });
  expect(q(el, "[data-adjust-target]")).toBeNull();
  expect(q(el, '[name="adjustQuantity"]')).toBeNull();
});
it("requires a mixed reason's note and keeps its kind choices scoped to that reason", async () => {
  const el = await mount();
  const seen = captures(el);
  await click(el, 'input[name="reason"][value="Mixed"]');
  await click(el, 'input[name="discountKind"][value="percent"]');
  await type(el, "percent", "10");
  await click(el, "[data-adjust-continue]");
  expect(seen).toEqual([]);
  expect(
    (q(el, '[name="note"]') as HTMLElement & { required: boolean; error: string }).required,
  ).toBe(true);
  await type(el, "note", "  delayed  ");
  await click(el, "[data-adjust-continue]");
  expect(seen).toEqual([
    { action: "discount_percent", reasonId: "Mixed", note: "delayed", percentBp: 1000 },
  ]);
});
it("checks a fixed amount against the covered two dishes, not the whole family", async () => {
  const el = await mount();
  const seen = captures(el);
  await click(el, 'input[name="reason"][value="Amount"]');
  await type(el, "adjustQuantity", "2");
  await type(el, "amount", "25");
  await click(el, "[data-adjust-continue]");
  expect(seen).toEqual([]);
  expect((q(el, '[name="amount"]') as HTMLElement & { error: string }).error).toContain("24.00");
});
it("a retained reason control cannot change a busy preview's draft", async () => {
  const el = await mount();
  const seen = captures(el);
  await click(el, 'input[name="reason"][value="Free"]');
  const change = q(el, 'input[name="reason"][value="Percent"]');
  el.busy = true;
  change.click();
  await el.updateComplete;
  el.busy = false;
  await el.updateComplete;
  await click(el, "[data-adjust-continue]");
  expect(seen).toEqual([{ action: "comp", reasonId: "Free", note: null }]);
});

it("a reason withdrawn after preview cannot be confirmed", async () => {
  const el = await mount();
  let asked: AdjustmentChoice | undefined;
  let confirms = 0;
  let edits = 0;
  el.addEventListener(
    "adjust-preview",
    (e) => (asked = (e as CustomEvent<AdjustmentChoice>).detail),
  );
  el.addEventListener("adjust-confirm", () => confirms++);
  el.addEventListener("adjust-edit", () => edits++);
  await click(el, 'input[name="reason"][value="Free"]');
  await click(el, "[data-adjust-continue]");
  el.choice = asked!;
  el.preview = {
    reduction: "36.00",
    nominalValue: "36.00",
    needsApproval: null,
    overBillDiscountLimit: false,
    lines: [],
  };
  await el.updateComplete;
  const confirm = q(el, "[data-adjust-confirm]");
  el.reasons = [reason("Free", ["cancel"])];
  confirm.click();
  await el.updateComplete;
  expect(confirms).toBe(0);
  expect(edits).toBe(1);
});
it("labels both preview and confirmation with the actual covered quantity", async () => {
  const el = await mount();
  const seen = captures(el);
  await click(el, 'input[name="reason"][value="Free"]');
  await type(el, "adjustQuantity", "2");
  expect(q(el, "[data-adjust-continue]").textContent!.trim()).toBe("Make 2 free");
  await click(el, "[data-adjust-continue]");
  el.choice = seen[0]!;
  el.preview = {
    reduction: "24.00",
    nominalValue: "24.00",
    needsApproval: null,
    overBillDiscountLimit: false,
    lines: [],
  };
  await el.updateComplete;
  expect(q(el, "[data-adjust-confirm]").textContent!.trim()).toBe("Make 2 free");
  expect(q(el, "[data-quantity-shown]").textContent!.trim()).toBe("How many: 2 of 3");
});

it("confirms the same choice when its object keys are in a different order", async () => {
  const el = await mount();
  let confirms = 0;
  el.addEventListener("adjust-confirm", () => confirms++);
  await click(el, 'input[name="reason"][value="Free"]');
  await click(el, "[data-adjust-continue]");
  el.choice = { note: null, reasonId: "Free", action: "comp" };
  el.preview = {
    reduction: "36.00",
    nominalValue: "36.00",
    needsApproval: null,
    overBillDiscountLimit: false,
    lines: [],
  };
  await el.updateComplete;
  await click(el, "[data-adjust-confirm]");
  expect(confirms).toBe(1);
});

it("uses the exact family total when all units' rounded shares do not add back to it", async () => {
  const el = await mount({ target: { ...dish, total: "10.00", unitTotal: "3.33" } });
  const seen = captures(el);
  await click(el, 'input[name="reason"][value="Amount"]');
  await type(el, "amount", "10");
  await click(el, "[data-adjust-continue]");
  expect(seen).toEqual([
    { action: "discount_amount", reasonId: "Amount", note: null, amount: "10" },
  ]);
});

it("opens quiet and waits for a reason before it can ask for a preview", async () => {
  const el = await mount();
  const button = q(el, "[data-adjust-continue]") as HTMLElement & {
    disabled: boolean;
    variant: string;
  };
  expect(button.disabled).toBe(true);
  expect(button.variant).toBe("secondary");
  await click(el, 'input[name="reason"][value="Free"]');
  expect(button.disabled).toBe(false);
  expect(button.variant).toBe("primary");
});
it("Enter in the whole-dish quantity field previews the chosen partial quantity", async () => {
  const el = await mount();
  const seen = captures(el);
  await click(el, 'input[name="reason"][value="Free"]');
  const stepper = q(el, '[name="adjustQuantity"]') as HTMLElement & {
    updateComplete: Promise<unknown>;
  };
  await stepper.updateComplete;
  await userEvent.fill(stepper.shadowRoot!.querySelector<HTMLInputElement>("input")!, "2");
  await userEvent.keyboard("{Enter}");
  await el.updateComplete;
  expect(seen).toEqual([{ action: "comp", reasonId: "Free", note: null, quantity: "2" }]);
});
