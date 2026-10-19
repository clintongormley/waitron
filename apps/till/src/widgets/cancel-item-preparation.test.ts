import { afterEach, beforeEach, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { CancellationRead } from "../api/line-cancel-types.js";
import { setLocale } from "../i18n/t.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import type { CancelItemChoice, TillCancelItemDialog } from "./cancel-item-dialog.js";
import "./cancel-item-dialog.js";

beforeEach(() => setLocale("en"));
afterEach(() => {
  cleanupWidgets();
  setLocale("en");
});
function consent(): CancellationRead {
  return {
    billId: "bill",
    revision: 4,
    billRevision: 2,
    context: {
      billStatus: "open",
      stage: "not_started",
      components: [
        {
          id: "ticket",
          lineId: "dish",
          state: "queued",
          firedAt: "2026-10-19T10:00:00Z",
          quantity: "3.000",
          kitchenQuantity: "3.000",
          servedQuantity: "0.000",
          cancelledQuantity: "0.000",
        },
      ],
    },
  };
}
async function mount(read = consent()) {
  const { el } = await mountWidget<TillCancelItemDialog>("till-cancel-item-dialog", {
    lineId: "dish",
    name: "Croquetas",
    consent: read,
  });
  const calls: CancelItemChoice[] = [];
  el.addEventListener("cancel-item-choice", (event) =>
    calls.push((event as CustomEvent<CancelItemChoice>).detail),
  );
  return { el, calls };
}
const root = (el: TillCancelItemDialog) => el.shadowRoot!;
const confirm = (el: TillCancelItemDialog) =>
  root(el).querySelector<HTMLElementTagNameMap["wt-button"]>("[data-confirm]")!;
async function click(el: TillCancelItemDialog, selector: string) {
  const control = root(el).querySelector<HTMLElement>(selector);
  expect(control).not.toBeNull();
  await userEvent.click(page.elementLocator(control!));
  await el.updateComplete;
}

it("requires the preparation answer before cancelling fired food and preserves No in its original context", async () => {
  const read = consent();
  const { el, calls } = await mount(read);
  expect(root(el).textContent).toContain("Has preparation started?");
  expect(confirm(el).disabled).toBe(true);
  confirm(el).click();
  expect(calls).toEqual([]);
  await click(el, 'input[name="preparation"][value="no"]');
  expect(confirm(el).disabled).toBe(false);
  await click(el, "[data-confirm]");
  expect(calls).toEqual([
    {
      lineId: "dish",
      quantity: "3",
      outcome: "remove_charge",
      preparationStarted: false,
      consent: read,
    },
  ]);
});

it("Yes requires a fresh started-dish money choice and sends Yes without rewriting the read", async () => {
  const read = consent();
  const { el, calls } = await mount(read);
  await click(el, 'input[name="preparation"][value="yes"]');
  expect(confirm(el).disabled).toBe(true);
  expect(
    [...root(el).querySelectorAll<HTMLInputElement>('input[name="outcome"]')].map((x) => x.value),
  ).toEqual(["keep_charge", "remove_charge"]);
  await click(el, 'input[value="keep_charge"]');
  await click(el, "[data-confirm]");
  expect(calls).toEqual([
    {
      lineId: "dish",
      quantity: "3",
      outcome: "keep_charge",
      preparationStarted: true,
      consent: read,
    },
  ]);
  expect(read.context.stage).toBe("not_started");
});

it("a changed answer discards the old money choice", async () => {
  const { el, calls } = await mount();
  await click(el, 'input[name="preparation"][value="yes"]');
  await click(el, 'input[value="keep_charge"]');
  await click(el, 'input[name="preparation"][value="no"]');
  await click(el, 'input[name="preparation"][value="yes"]');
  expect(confirm(el).disabled).toBe(true);
  confirm(el).click();
  expect(calls).toEqual([]);
});

it("kitchen advancement clears the manual answer rather than carrying it into new consent", async () => {
  const { el, calls } = await mount();
  await click(el, 'input[name="preparation"][value="no"]');
  const next = consent();
  next.context.stage = "started";
  next.context.components[0]!.state = "preparing";
  el.consent = next;
  await el.updateComplete;
  expect(root(el).querySelector('input[name="preparation"]')).toBeNull();
  expect(confirm(el).disabled).toBe(true);
  await click(el, 'input[value="keep_charge"]');
  await click(el, "[data-confirm]");
  expect(calls).toEqual([{ lineId: "dish", quantity: "3", outcome: "keep_charge", consent: next }]);
});

it("an equivalent refresh retains the answer, and a changed component resets it", async () => {
  const { el } = await mount();
  await click(el, 'input[name="preparation"][value="no"]');
  el.consent = structuredClone(el.consent);
  await el.updateComplete;
  expect(root(el).querySelector<HTMLInputElement>('input[value="no"]')!.checked).toBe(true);
  el.consent = consent();
  el.consent.context.components[0]!.quantity = "2.000";
  await el.updateComplete;
  expect(confirm(el).disabled).toBe(true);
  expect(root(el).querySelectorAll('input[name="preparation"]:checked')).toHaveLength(0);
});

it.each(["held", "started"])("does not ask for preparation for %s food", async (stage) => {
  const read = consent();
  if (stage === "held") read.context.components[0]!.firedAt = null;
  else {
    read.context.stage = "started";
    read.context.components[0]!.state = "preparing";
  }
  const { el } = await mount(read);
  expect(root(el).querySelector('input[name="preparation"]')).toBeNull();
});

it("asks when an extra has fired even if its parent is held", async () => {
  const read = consent();
  read.context.components.push({
    ...read.context.components[0]!,
    lineId: "extra",
    id: "extra-ticket",
  });
  read.context.components[0]!.firedAt = null;
  const { el } = await mount(read);
  expect(root(el).querySelectorAll('input[name="preparation"]')).toHaveLength(2);
  expect(confirm(el).disabled).toBe(true);
});

it("Spanish uses the owner's preparation wording on the actual question", async () => {
  setLocale("es");
  const { el } = await mount();
  expect(root(el).querySelector("[data-preparation] legend")?.textContent).toContain(
    "En preparación",
  );
  expect(root(el).querySelector('input[value="yes"]')?.parentElement?.textContent).toContain("Sí");
  expect(root(el).querySelector('input[value="no"]')?.parentElement?.textContent).toContain("No");
});

it("a paid fired dish retains the answer through the public-refund choice", async () => {
  const read = consent();
  read.context.billStatus = "settled";
  read.saleId = "sale";
  const { el, calls } = await mount(read);
  el.refundAvailable = true;
  await el.updateComplete;
  expect(confirm(el).disabled).toBe(true);
  await click(el, 'input[name="preparation"][value="no"]');
  await click(el, 'input[value="refund"]');
  await click(el, "[data-confirm]");
  expect(calls).toEqual([
    { lineId: "dish", quantity: "3", outcome: "refund", preparationStarted: false, consent: read },
  ]);
});

it("does not accept a preparation change while the command is busy", async () => {
  const { el, calls } = await mount();
  await click(el, 'input[name="preparation"][value="no"]');
  el.busy = true;
  await el.updateComplete;
  root(el)
    .querySelector<HTMLInputElement>('input[value="yes"]')!
    .dispatchEvent(new Event("change"));
  el.busy = false;
  await el.updateComplete;
  expect(root(el).querySelector<HTMLInputElement>('input[value="no"]')!.checked).toBe(true);
  await click(el, "[data-confirm]");
  expect(calls[0]).toMatchObject({ outcome: "remove_charge", preparationStarted: false });
});

it("uses Remove for held food without claiming a kitchen stage", async () => {
  const read = consent();
  read.context.components[0]!.firedAt = null;
  const { el, calls } = await mount(read);
  expect(root(el).querySelector("[data-stage]")).toBeNull();
  expect(confirm(el).textContent?.trim()).toBe("Remove");
  await click(el, "[data-confirm]");
  expect(calls).toEqual([
    { lineId: "dish", quantity: "3", outcome: "remove_charge", consent: read },
  ]);
});

it("does not tell the waiter fired food has not started before they answer", async () => {
  const { el } = await mount();
  expect(root(el).querySelector("[data-stage]")).toBeNull();
  await click(el, 'input[name="preparation"][value="yes"]');
  expect(root(el).querySelector("[data-stage]")?.textContent).toContain("Already being prepared");
});
