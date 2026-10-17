import { afterEach, beforeEach, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { LitElement } from "lit";
import type { CancellationRead } from "../api/line-cancel-types.js";
import { setLocale } from "../i18n/t.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import "./cancel-item-dialog.js";

type Dialog = LitElement & {
  name: string;
  lineId: string;
  unitPrecision: number;
  consent: CancellationRead | null;
  refundAvailable: boolean;
  busy: boolean;
  refusal: string;
};
const read = (
  status: CancellationRead["context"]["billStatus"] = "open",
  stage: CancellationRead["context"]["stage"] = "not_started",
): CancellationRead => ({
  billId: "bill-1",
  revision: 4,
  billRevision: 2,
  context: {
    billStatus: status,
    stage,
    components: [
      {
        id: "ticket-1",
        lineId: "dish-1",
        state: stage === "started" ? "preparing" : "queued",
        firedAt: "2026-10-17T10:00:00Z",
        quantity: "3.000",
        kitchenQuantity: "3.000",
        servedQuantity: "0.000",
        cancelledQuantity: "0.000",
      },
    ],
  },
});
beforeEach(() => setLocale("en"));
afterEach(() => {
  cleanupWidgets();
  setLocale("en");
});
async function mount(over: Partial<Dialog> = {}) {
  const { el } = await mountWidget<Dialog>("till-cancel-item-dialog", {
    name: "Pizza",
    lineId: "dish-1",
    unitPrecision: 0,
    consent: read(),
    refundAvailable: false,
    busy: false,
    refusal: "",
    ...over,
  });
  await el.updateComplete;
  return el;
}
const root = (el: Dialog) => el.shadowRoot!;
const button = (el: Dialog) =>
  root(el).querySelector<HTMLElementTagNameMap["wt-button"]>("[data-confirm]")!;
const choices = (el: Dialog) =>
  [...root(el).querySelectorAll<HTMLInputElement>("input[name=outcome]")].map((x) => x.value);
async function click(el: Dialog, selector = "[data-confirm]") {
  await userEvent.click(page.elementLocator(root(el).querySelector<HTMLElement>(selector)!));
  await el.updateComplete;
}
async function fill(el: Dialog, value: string) {
  const stepper = root(el).querySelector("wt-number-stepper")!;
  await stepper.updateComplete;
  await userEvent.fill(page.elementLocator(stepper.shadowRoot!.querySelector("input")!), value);
  await el.updateComplete;
}
function collect(el: Dialog) {
  const calls: unknown[] = [];
  el.addEventListener("cancel-item-choice", (e) => calls.push((e as CustomEvent).detail));
  return calls;
}

it("offers only off-bill cancellation before preparation and carries the full consent", async () => {
  const consent = read();
  const el = await mount({ consent });
  const calls = collect(el);
  expect(choices(el)).toEqual(["remove_charge"]);
  expect(root(el).textContent).toContain("Pizza");
  await fill(el, "2");
  await click(el);
  expect(calls).toEqual([{ lineId: "dish-1", quantity: "2", outcome: "remove_charge", consent }]);
  // A second click while the app processes the choice must not repeat it.
  button(el).click();
  expect(calls).toHaveLength(1);
});
it("requires an explicit money choice for started work", async () => {
  const el = await mount({ consent: read("open", "started") });
  const calls = collect(el);
  expect(choices(el)).toEqual(["keep_charge", "remove_charge"]);
  expect(root(el).textContent).toContain("Already being prepared or served");
  expect(button(el).disabled).toBe(true);
  expect(button(el).variant).toBe("secondary");
  await click(el, "input[value=keep_charge]");
  expect(button(el).disabled).toBe(false);
  expect(button(el).variant).toBe("danger");
  await click(el);
  expect(calls).toEqual([
    { lineId: "dish-1", quantity: "3", outcome: "keep_charge", consent: read("open", "started") },
  ]);
});
it.each(["not_started", "started"] as const)(
  "paid %s work offers refund only when its public handoff is available",
  async (stage) => {
    const el = await mount({ consent: read("settled", stage) });
    expect(choices(el)).toEqual(["keep_charge"]);
    el.refundAvailable = true;
    await el.updateComplete;
    expect(choices(el)).toEqual(["keep_charge", "refund"]);
    expect(button(el).disabled).toBe(true);
    const calls = collect(el);
    await click(el, "input[value=refund]");
    await click(el);
    expect(calls).toEqual([
      { lineId: "dish-1", quantity: "3", outcome: "refund", consent: read("settled", stage) },
    ]);
    expect(Object.keys(calls[0] as object)).not.toContain("amount");
  },
);
it("requires paid keep-payment consent even when refund is unavailable", async () => {
  const el = await mount({ consent: read("settled") });
  expect(button(el).disabled).toBe(true);
  expect(root(el).textContent).toContain("Cancel, keep the payment");
  await click(el, "input[value=keep_charge]");
  expect(button(el).disabled).toBe(false);
});
it.each(["", "0", "-1", "1.5", "4", "abc", "1e0"])(
  "refuses invalid whole-dish quantity %j without sending",
  async (value) => {
    const el = await mount();
    const calls = collect(el);
    await fill(el, value);
    button(el).click();
    await el.updateComplete;
    expect(calls).toEqual([]);
    expect(root(el).querySelector("wt-number-stepper")!.error).not.toBe("");
    expect(button(el).disabled).toBe(true);
    await fill(el, "2");
    expect(root(el).querySelector("wt-number-stepper")!.error).toBe("");
    expect(button(el).disabled).toBe(false);
  },
);
it("offers only the active quantity after a charged cancellation", async () => {
  const consent = read();
  consent.context.components[0]!.cancelledQuantity = "2.000";
  const el = await mount({ consent });
  const calls = collect(el);
  expect(root(el).querySelector("wt-number-stepper")!.max).toBe(1);
  await click(el);
  expect(calls).toEqual([{ lineId: "dish-1", quantity: "1", outcome: "remove_charge", consent }]);
});
it("cancels a weighed dish only as its whole active quantity", async () => {
  const consent = read();
  Object.assign(consent.context.components[0]!, { quantity: "1.250", cancelledQuantity: "0.500" });
  const el = await mount({ consent, unitPrecision: 3 });
  const calls = collect(el);
  expect(root(el).querySelector("wt-number-stepper")).toBeNull();
  expect(root(el).textContent).toContain("0.75");
  await click(el);
  expect(calls).toEqual([
    { lineId: "dish-1", quantity: "0.750", outcome: "remove_charge", consent },
  ]);
});
it.each(["exhausted", "missing", "abandoned"])(
  "offers no confirmation for an %s subject",
  async (why) => {
    const consent = read();
    if (why === "exhausted") consent.context.components[0]!.cancelledQuantity = "3.000";
    if (why === "missing") consent.context.components[0]!.lineId = "another-dish";
    if (why === "abandoned") consent.context.billStatus = "abandoned";
    const el = await mount({ consent });
    expect(button(el).disabled).toBe(true);
    expect(choices(el)).toEqual([]);
  },
);
it("clears pre-start consent when a refresh reports kitchen advancement", async () => {
  const el = await mount();
  const calls = collect(el);
  await fill(el, "2");
  el.consent = read("open", "started");
  await el.updateComplete;
  expect(button(el).disabled).toBe(true);
  expect(choices(el)).toEqual(["keep_charge", "remove_charge"]);
  await click(el, "input[value=remove_charge]");
  await click(el);
  expect(calls).toEqual([
    { lineId: "dish-1", quantity: "3", outcome: "remove_charge", consent: read("open", "started") },
  ]);
});
it("forgets a chosen refund when it becomes unavailable", async () => {
  const el = await mount({ consent: read("settled"), refundAvailable: true });
  await click(el, "input[value=refund]");
  el.refundAvailable = false;
  await el.updateComplete;
  expect(button(el).disabled).toBe(true);
  expect(choices(el)).toEqual(["keep_charge"]);
});
it("a generic refusal permits retry and retains the chosen quantity", async () => {
  const el = await mount();
  const calls = collect(el);
  await fill(el, "2");
  await click(el);
  el.refusal = "Connection failed";
  await el.updateComplete;
  const actions = root(el).querySelector("wt-form-actions")!;
  await actions.updateComplete;
  expect(actions.shadowRoot!.textContent).toContain("Connection failed");
  expect(button(el).disabled).toBe(false);
  await click(el);
  expect(calls).toHaveLength(2);
  expect(calls[1]).toEqual(calls[0]);
});
it("keeps controls inert while busy and after disconnection", async () => {
  const el = await mount({ busy: true });
  const calls = collect(el);
  button(el).click();
  expect(calls).toEqual([]);
  el.busy = false;
  await el.updateComplete;
  const submit = button(el);
  el.remove();
  submit.click();
  expect(calls).toEqual([]);
});
it("does not expose a caller-mutable consent through its choice event", async () => {
  const consent = read();
  const el = await mount({ consent });
  const calls = collect(el);
  await click(el);
  consent.context.components[0]!.quantity = "99.000";
  expect((calls[0] as { consent: CancellationRead }).consent.context.components[0]!.quantity).toBe(
    "3.000",
  );
});

it("retains a choice across an equivalent passive refresh with different object and component order", async () => {
  const consent = read("open", "started");
  consent.context.components.push({
    ...consent.context.components[0]!,
    id: "extra-ticket",
    lineId: "extra",
    quantity: "6.000",
    kitchenQuantity: "6.000",
  });
  const el = await mount({ consent });
  const calls = collect(el);
  await fill(el, "2");
  await click(el, "input[value=keep_charge]");
  el.consent = {
    ...consent,
    context: {
      ...consent.context,
      components: [...consent.context.components]
        .reverse()
        .map((row) => Object.fromEntries(Object.entries(row).reverse()) as typeof row),
    },
  };
  await el.updateComplete;
  expect(button(el).disabled).toBe(false);
  await click(el);
  expect(calls).toEqual([
    { lineId: "dish-1", quantity: "2", outcome: "keep_charge", consent: el.consent },
  ]);
});
it.each([
  "paid",
  "extra",
  "quantity",
  "kitchenQuantity",
  "servedQuantity",
  "cancelledQuantity",
  "revision",
  "billRevision",
  "firedAt",
  "ticketId",
])("a changed %s refresh requires fresh money consent", async (change) => {
  const consent = read("open", "started");
  const el = await mount({ consent });
  await click(el, "input[value=keep_charge]");
  const next = structuredClone(consent);
  if (change === "paid") next.context.billStatus = "settled";
  else if (change === "extra")
    next.context.components.push({
      ...next.context.components[0]!,
      lineId: "extra",
      id: "extra-ticket",
    });
  else if (change === "revision") next.revision++;
  else if (change === "billRevision") next.billRevision++;
  else if (change === "firedAt") next.context.components[0]!.firedAt = null;
  else if (change === "ticketId") next.context.components[0]!.id = "replacement";
  else Object.assign(next.context.components[0]!, { [change]: "1.000" });
  el.consent = next;
  await el.updateComplete;
  expect(button(el).disabled).toBe(true);
  expect(root(el).querySelectorAll("input:checked")).toHaveLength(0);
});
it("Enter on the quantity field confirms once and contains the primitive change event", async () => {
  const el = await mount();
  const calls = collect(el);
  const leaks: Event[] = [];
  el.addEventListener("wt-change", (event) => leaks.push(event));
  await fill(el, "2");
  const stepper = root(el).querySelector("wt-number-stepper")!;
  const input = stepper.shadowRoot!.querySelector("input")!;
  await userEvent.click(page.elementLocator(input));
  await userEvent.keyboard("{Enter}");
  await el.updateComplete;
  expect(calls).toHaveLength(1);
  expect(leaks).toEqual([]);
});
it("Close and native Escape emit a contained close once without a choice", async () => {
  const el = await mount();
  const calls = collect(el);
  const closed: Event[] = [];
  const leaked: Event[] = [];
  el.addEventListener("cancel-item-close", (event) => closed.push(event));
  el.addEventListener("wt-close", (event) => leaked.push(event));
  await userEvent.keyboard("{Escape}");
  await expect.poll(() => closed.length).toBe(1);
  expect(calls).toEqual([]);
  expect(leaked).toEqual([]);
  root(el).querySelector<HTMLElement>("[data-close]")!.click();
  expect(closed).toHaveLength(1);
});
it("normalizes a whole quantity with leading zeros before handing it to the server flow", async () => {
  const el = await mount();
  const calls = collect(el);
  await fill(el, "02");
  await click(el);
  expect(calls).toEqual([
    { lineId: "dish-1", quantity: "2", outcome: "remove_charge", consent: read() },
  ]);
});
it("marks the quantity as required for a counted dish", async () => {
  const el = await mount();
  expect(root(el).querySelector("wt-number-stepper")!.required).toBe(true);
});
it.each(["replacement", "in-place"])(
  "never confirms refreshed %s facts before the new choices have rendered",
  async (mode) => {
    const el = await mount();
    const calls = collect(el);
    const next = mode === "replacement" ? read("open", "started") : el.consent!;
    next.context.stage = "started";
    if (mode === "replacement") el.consent = next;
    button(el).click();
    expect(calls).toEqual([]);
    await el.updateComplete;
    expect(button(el).disabled).toBe(true);
    await click(el, "input[value=remove_charge]");
    await click(el);
    expect(calls).toHaveLength(1);
    expect((calls[0] as { consent: CancellationRead }).consent.context.stage).toBe("started");
  },
);
it("an invalid submission puts focus back in the marked quantity field", async () => {
  const el = await mount();
  await fill(el, "0");
  await click(el);
  const field = root(el).querySelector("wt-number-stepper")!;
  await expect
    .poll(() => field.shadowRoot!.activeElement)
    .toBe(field.shadowRoot!.querySelector("input"));
});
it("the native minus and plus controls stop at one and the active maximum", async () => {
  const el = await mount();
  const field = root(el).querySelector("wt-number-stepper")!;
  await field.updateComplete;
  const minus = field.shadowRoot!.querySelector<HTMLButtonElement>('[data-step="-1"]')!;
  const plus = field.shadowRoot!.querySelector<HTMLButtonElement>('[data-step="1"]')!;
  expect(plus.disabled).toBe(true);
  await userEvent.click(page.elementLocator(minus));
  await userEvent.click(page.elementLocator(minus));
  await el.updateComplete;
  expect(field.value).toBe("1");
  expect(minus.disabled).toBe(true);
  await userEvent.click(page.elementLocator(plus));
  await el.updateComplete;
  const calls = collect(el);
  await click(el);
  expect(calls).toEqual([
    { lineId: "dish-1", quantity: "2", outcome: "remove_charge", consent: read() },
  ]);
});
