import { afterEach, beforeEach, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { AdjustmentReason } from "../api/client.js";
import type { CancellationRead } from "../api/line-cancel-types.js";
import { setLocale, t } from "../i18n/t.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import type { CancelItemChoice, TillCancelItemDialog } from "./cancel-item-dialog.js";
import "./cancel-item-dialog.js";

const house: AdjustmentReason = {
  id: "house",
  name: "House decision",
  actions: ["cancel"],
  noteRequired: false,
  maxPercentBp: null,
  maxAmount: null,
  applyRole: "manager",
  approverRole: "manager",
};
const other: AdjustmentReason = { ...house, id: "other", name: "Other reason", noteRequired: true };
const read = (): CancellationRead => ({
  billId: "bill",
  revision: 4,
  billRevision: 2,
  context: {
    billStatus: "open",
    stage: "started",
    components: [
      {
        id: "ticket",
        lineId: "dish",
        state: "preparing",
        firedAt: "2026-10-19T10:00:00Z",
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
async function mount() {
  const { el } = await mountWidget<TillCancelItemDialog>("till-cancel-item-dialog", {
    lineId: "dish",
    name: "Croquetas",
    consent: read(),
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
async function reason(el: TillCancelItemDialog, value: string) {
  const combo = root(el).querySelector("wt-combobox");
  expect(combo).not.toBeNull();
  await combo!.updateComplete;
  await userEvent.click(
    page.elementLocator(combo!.shadowRoot!.querySelector<HTMLElement>("[aria-haspopup=listbox]")!),
  );
  await combo!.updateComplete;
  const option = [...combo!.shadowRoot!.querySelectorAll<HTMLElement>("[role=option]")].find(
    (row) => row.textContent?.trim() === value,
  )!;
  await userEvent.click(page.elementLocator(option));
  await el.updateComplete;
}
async function note(el: TillCancelItemDialog, value: string) {
  const field = root(el).querySelector<HTMLElementTagNameMap["wt-input"]>("wt-input[name=note]")!;
  expect(field).not.toBeNull();
  await field.updateComplete;
  await userEvent.fill(page.elementLocator(field.shadowRoot!.querySelector("input")!), value);
  await el.updateComplete;
}

it("loads reasons only for a charged choice, then requires one before sending", async () => {
  const { el, calls } = await mount();
  const requests: Event[] = [];
  el.addEventListener("cancel-item-reasons", (event) => requests.push(event));
  expect(requests).toEqual([]);
  await click(el, "input[value=keep_charge]");
  expect(requests).toHaveLength(1);
  expect(confirm(el).disabled).toBe(true);
  expect(calls).toEqual([]);
  Object.assign(el, {
    reasons: [
      house,
      other,
      { ...house, id: "discount", name: "Discount only", actions: ["discount_amount"] },
    ],
  });
  await el.updateComplete;
  const combo = root(el).querySelector("wt-combobox")!;
  expect(combo).not.toBeNull();
  expect(combo.required).toBe(true);
  expect(combo.options).toEqual([
    { value: "house", label: "House decision" },
    { value: "other", label: "Other reason" },
  ]);
  await reason(el, "House decision");
  expect(confirm(el).disabled).toBe(false);
  await click(el, "[data-confirm]");
  expect(calls).toEqual([
    { lineId: "dish", quantity: "3", outcome: "keep_charge", consent: read(), reasonId: "house" },
  ]);
});

it("marks a required note after an invalid attempt, keeps the action disabled until fixed, and sends the trimmed note", async () => {
  const { el, calls } = await mount();
  Object.assign(el, { reasons: [house, other] });
  await click(el, "input[value=keep_charge]");
  await reason(el, "Other reason");
  await note(el, "   ");
  await click(el, "[data-confirm]");
  expect(calls).toEqual([]);
  const field = root(el).querySelector<HTMLElementTagNameMap["wt-input"]>("wt-input[name=note]")!;
  expect(field.required).toBe(true);
  expect(field.error).toBe("This reason needs a note");
  expect(root(el).querySelector("wt-form-actions")!.error).toBe(
    "Correct the highlighted fields to continue.",
  );
  expect(confirm(el).disabled).toBe(true);
  await note(el, "  Dropped before serving  ");
  expect(field.error).toBe("");
  expect(confirm(el).disabled).toBe(false);
  await click(el, "[data-confirm]");
  expect(calls[0]).toMatchObject({
    outcome: "keep_charge",
    reasonId: "other",
    note: "Dropped before serving",
  });
});

it("keeps reason and note across equivalent reads but clears them for changed kitchen facts", async () => {
  const { el, calls } = await mount();
  Object.assign(el, { reasons: [house, other] });
  await click(el, "input[value=keep_charge]");
  await reason(el, "Other reason");
  await note(el, "Dropped");
  el.consent = structuredClone(el.consent);
  await el.updateComplete;
  expect(root(el).querySelector("wt-combobox")!.value).toBe("other");
  expect(
    root(el).querySelector<HTMLElementTagNameMap["wt-input"]>("wt-input[name=note]")!.value,
  ).toBe("Dropped");
  const changed = read();
  changed.context.components[0]!.quantity = "2.000";
  el.consent = changed;
  await el.updateComplete;
  await click(el, "input[value=keep_charge]");
  expect(root(el).querySelector("wt-combobox")!.value).toBe("");
  expect(confirm(el).disabled).toBe(true);
  expect(calls).toEqual([]);
});

it("places a server note refusal under the note and keeps a valid draft retryable", async () => {
  const { el, calls } = await mount();
  Object.assign(el, { reasons: [other] });
  await click(el, "input[value=keep_charge]");
  await reason(el, "Other reason");
  await note(el, "Dropped");
  await click(el, "[data-confirm]");
  Object.assign(el, { refusal: "This reason needs a note", refusalField: "note" });
  await el.updateComplete;
  expect(
    root(el).querySelector<HTMLElementTagNameMap["wt-input"]>("wt-input[name=note]")!.error,
  ).toBe("This reason needs a note");
  expect(root(el).querySelector("wt-form-actions")!.error).toBe(
    "Correct the highlighted fields to continue.",
  );
  expect(confirm(el).disabled).toBe(false);
  await note(el, "Dropped on the floor");
  expect(
    root(el).querySelector<HTMLElementTagNameMap["wt-input"]>("wt-input[name=note]")!.error,
  ).toBe("");
  await click(el, "[data-confirm]");
  expect(calls).toHaveLength(2);
  expect(calls[1]).toMatchObject({ reasonId: "other", note: "Dropped on the floor" });
});

it("requires the paid cancellation's reason before entering the independent refund flow", async () => {
  const { el, calls } = await mount();
  const consent = read();
  consent.context.billStatus = "settled";
  consent.saleId = "sale";
  Object.assign(el, { consent, refundAvailable: true, reasons: [house] });
  await el.updateComplete;
  await click(el, "input[value=refund]");
  expect(confirm(el).disabled).toBe(true);
  await reason(el, "House decision");
  await click(el, "[data-confirm]");
  expect(calls).toEqual([
    { lineId: "dish", quantity: "3", outcome: "refund", consent, reasonId: "house" },
  ]);
});

it("does not reuse a note from a different selected reason", async () => {
  const { el, calls } = await mount();
  Object.assign(el, { reasons: [house, other] });
  await click(el, "input[value=keep_charge]");
  await reason(el, "Other reason");
  await note(el, "Dropped");
  await reason(el, "House decision");
  expect(
    root(el).querySelector<HTMLElementTagNameMap["wt-input"]>("wt-input[name=note]"),
  ).toBeNull();
  await click(el, "[data-confirm]");
  expect(calls[0]).not.toHaveProperty("note");
});

it("re-asks when the selected reason disappears and never sends its old id", async () => {
  const { el, calls } = await mount();
  Object.assign(el, { reasons: [house, other] });
  await click(el, "input[value=keep_charge]");
  await reason(el, "House decision");
  Object.assign(el, { reasons: [other] });
  await el.updateComplete;
  expect(confirm(el).disabled).toBe(true);
  confirm(el).click();
  await el.updateComplete;
  expect(calls).toEqual([]);
  Object.assign(el, { reasons: [house, other] });
  await el.updateComplete;
  expect(root(el).querySelector("wt-combobox")!.value).toBe("");
  expect(confirm(el).disabled).toBe(true);
});

it("explains an empty cancel-reason list without offering an unrecorded charged cancellation", async () => {
  const { el, calls } = await mount();
  el.reasons = [];
  await click(el, "input[value=keep_charge]");
  expect(root(el).textContent).toContain(t("adjust.no_reasons"));
  expect(confirm(el).disabled).toBe(true);
  confirm(el).click();
  await el.updateComplete;
  expect(calls).toEqual([]);
});

it("changing the reason clears the previous reason's server note refusal", async () => {
  const { el, calls } = await mount();
  el.reasons = [house, other];
  await click(el, "input[value=keep_charge]");
  await reason(el, "Other reason");
  await note(el, "Dropped");
  await click(el, "[data-confirm]");
  el.refusal = "This reason needs a note";
  el.refusalField = "note";
  await el.updateComplete;
  await reason(el, "House decision");
  expect(root(el).querySelector("wt-form-actions")!.error).toBe("");
  expect(
    root(el).querySelector<HTMLElementTagNameMap["wt-input"]>("wt-input[name=note]"),
  ).toBeNull();
  await click(el, "[data-confirm]");
  expect(calls).toHaveLength(2);
  expect(calls[1]).toMatchObject({ reasonId: "house" });
  expect(calls[1]).not.toHaveProperty("note");
});

it("lets a Spanish waiter search reasons and read the localized empty result", async () => {
  setLocale("es");
  const { el } = await mount();
  el.reasons = [house, other];
  await click(el, "input[value=keep_charge]");
  const combo = root(el).querySelector("wt-combobox")!;
  await combo.updateComplete;
  await userEvent.click(
    page.elementLocator(combo.shadowRoot!.querySelector<HTMLElement>("[aria-haspopup=listbox]")!),
  );
  await combo.updateComplete;
  const search = combo.shadowRoot!.querySelector<HTMLInputElement>('input[role="combobox"]')!;
  expect(search.placeholder).toBe("Buscar");
  await userEvent.fill(page.elementLocator(search), "no matching reason");
  await combo.updateComplete;
  expect(combo.shadowRoot!.textContent).toContain("Sin resultados");
});
