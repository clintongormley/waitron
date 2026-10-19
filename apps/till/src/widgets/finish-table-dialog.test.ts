import { afterEach, beforeEach, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { LitElement } from "lit";
import type { AdjustmentReason } from "../api/client.js";
import type { UnservedDish } from "../api/finish-table-types.js";
import { setLocale } from "../i18n/t.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import "./finish-table-dialog.js";
import { dialogOpenUnder } from "./track-dialog.js";

const house: AdjustmentReason = {
  id: "house",
  name: "House",
  actions: ["cancel"],
  noteRequired: false,
  maxPercentBp: null,
  maxAmount: null,
  applyRole: "manager",
  approverRole: "manager",
};
const other = { ...house, id: "other", name: "Other", noteRequired: true };
function dish(lineId: string, stage: "held" | "fired" | "started" = "held"): UnservedDish {
  return {
    billId: `bill-${lineId}`,
    billRevision: 7,
    lineId,
    name: lineId === "flan" ? "Flan" : "Croquetas",
    quantity: lineId === "flan" ? "1.000" : "2.000",
    context: {
      billStatus: "settled",
      stage: stage === "started" ? "started" : "not_started",
      components: [
        {
          id: `ticket-${lineId}`,
          lineId,
          state: stage === "started" ? "preparing" : "queued",
          firedAt: stage === "held" ? null : "2026-10-19T12:00:00Z",
          quantity: "3.000",
          kitchenQuantity: "3.000",
          servedQuantity: "0.000",
          cancelledQuantity: "0.000",
        },
      ],
    },
  };
}
type Dialog = LitElement & {
  dishes: UnservedDish[];
  refunds: Record<string, string>;
  refundAtTill: boolean;
  reasons: AdjustmentReason[] | null;
  defaultReasonId: string;
  reasonsLoading: boolean;
  busy: boolean;
  refusal: string;
};
beforeEach(() => setLocale("en"));
afterEach(() => {
  cleanupWidgets();
  setLocale("en");
});
async function mount(props: Partial<Dialog> = {}) {
  const { el } = await mountWidget<Dialog>("till-finish-table-dialog", {
    dishes: [dish("flan"), dish("croquetas", "started")],
    refunds: { flan: "5.50", croquetas: "15.00" },
    reasons: [house, other],
    ...props,
  });
  return el;
}
const root = (el: Dialog) => el.shadowRoot!;
const button = (el: Dialog) =>
  root(el).querySelector<HTMLElementTagNameMap["wt-button"]>("wt-button[data-confirm]")!;
async function click(el: Dialog, selector: string) {
  await userEvent.click(page.elementLocator(root(el).querySelector<HTMLElement>(selector)!));
  await el.updateComplete;
}
async function reason(el: Dialog, id = "house") {
  root(el)
    .querySelector("wt-combobox")!
    .dispatchEvent(
      new CustomEvent("wt-change", {
        detail: { value: id },
        bubbles: true,
        composed: true,
      }),
    );
  await el.updateComplete;
}
function collect(el: Dialog) {
  const calls: unknown[] = [];
  el.addEventListener("finish-table-choice", (event) => calls.push((event as CustomEvent).detail));
  return calls;
}
it("lists the entire unserved set with known preparation and waits for a reason", async () => {
  const el = await mount();
  expect(el.shadowRoot?.textContent ?? "").toContain("Flan");
  expect(root(el).querySelector("wt-dialog")!.heading).toBe("3 dishes not served");
  expect(root(el).textContent).toContain("Croquetas");
  const rows = root(el).querySelectorAll("[data-dish]");
  expect(rows).toHaveLength(2);
  expect(rows[0]!.textContent).toContain("No");
  expect(rows[1]!.textContent).toContain("Yes");
  expect(
    root(el).querySelector<HTMLInputElement>('[data-dish="flan"] input[name=refund]')!.checked,
  ).toBe(true);
  expect(
    root(el).querySelector<HTMLInputElement>('[data-dish="croquetas"] input[name=refund]')!.checked,
  ).toBe(false);
  expect(button(el).disabled).toBe(true);
  expect(button(el).variant).toBe("secondary");
  expect(dialogOpenUnder(el)).toBe(true);
});
it("confirms all dishes with exact observed contexts and one reason without returning money itself", async () => {
  const el = await mount();
  const calls = collect(el);
  await reason(el);
  expect(button(el).disabled).toBe(false);
  expect(button(el).variant).toBe("danger");
  expect(button(el).textContent).toContain("Cancel and refund €5.50");
  await click(el, "[data-confirm]");
  expect(calls).toEqual([
    {
      cancellations: [
        {
          lineId: "flan",
          quantity: "1.000",
          expectedBillRevision: 7,
          expectedContext: dish("flan").context,
          refundHandoff: true,
          reasonId: "house",
        },
        {
          lineId: "croquetas",
          quantity: "2.000",
          expectedBillRevision: 7,
          expectedContext: dish("croquetas", "started").context,
          reasonId: "house",
        },
      ],
    },
  ]);
  button(el).click();
  expect(calls).toHaveLength(1);
});
it.each([true, false])(
  "fired food requires an explicit preparation answer %s before refund is offered",
  async (started) => {
    const el = await mount({ dishes: [dish("flan", "fired")] });
    await reason(el);
    const calls = collect(el);
    expect(button(el).disabled).toBe(true);
    expect(root(el).querySelector('input[name="refund"]')).toBeNull();
    await click(el, `input[value="${started ? "yes" : "no"}"]`);
    expect(root(el).querySelector<HTMLInputElement>('input[name="refund"]')!.checked).toBe(
      !started,
    );
    await click(el, "[data-confirm]");
    expect(calls).toEqual([
      {
        cancellations: [
          {
            lineId: "flan",
            quantity: "1.000",
            expectedBillRevision: 7,
            expectedContext: dish("flan", "fired").context,
            preparationStarted: started,
            ...(!started ? { refundHandoff: true } : {}),
            reasonId: "house",
          },
        ],
      },
    ]);
  },
);
it("lets staff change each refund tick and sums the selected dish amounts exactly", async () => {
  const el = await mount();
  await reason(el);
  await click(el, '[data-dish="croquetas"] input[name=refund]');
  expect(button(el).textContent).toContain("€20.50");
  await click(el, '[data-dish="flan"] input[name=refund]');
  expect(button(el).textContent).toContain("€15.00");
  await click(el, '[data-dish="croquetas"] input[name=refund]');
  expect(button(el).textContent?.trim()).toBe("Cancel");
});
it("hides unavailable refund choices and points to a till without asking for approval", async () => {
  const el = await mount({ refunds: {}, refundAtTill: true });
  await reason(el);
  expect(root(el).querySelector("input[name=refund]")).toBeNull();
  expect(root(el).textContent).toContain("Give the money back at a till");
  expect(button(el).textContent?.trim()).toBe("Cancel");
  const calls = collect(el);
  await click(el, "[data-confirm]");
  expect(calls).toEqual([
    {
      cancellations: [
        {
          lineId: "flan",
          quantity: "1.000",
          expectedBillRevision: 7,
          expectedContext: dish("flan").context,
          reasonId: "house",
        },
        {
          lineId: "croquetas",
          quantity: "2.000",
          expectedBillRevision: 7,
          expectedContext: dish("croquetas", "started").context,
          reasonId: "house",
        },
      ],
    },
  ]);
});
it("uses only an explicitly identified offered default reason", async () => {
  const el = await mount({ defaultReasonId: "house" });
  expect(root(el).querySelector("wt-combobox")!.value).toBe("house");
  expect(button(el).disabled).toBe(false);
  el.defaultReasonId = "not-found";
  el.dishes = [dish("flan")];
  await el.updateComplete;
  expect(root(el).querySelector("wt-combobox")!.value).toBe("");
  expect(button(el).disabled).toBe(true);
});
it("requires Other's note, marks a synthetic invalid submission, and sends the trimmed note", async () => {
  const el = await mount();
  await reason(el, "other");
  const calls = collect(el);
  expect(button(el).disabled).toBe(true);
  button(el).click();
  await el.updateComplete;
  const note = root(el).querySelector("wt-input")!;
  expect(note.required).toBe(true);
  expect(note.error).not.toBe("");
  expect(root(el).querySelector("wt-form-actions")!.error).not.toBe("");
  expect(calls).toEqual([]);
  await note.updateComplete;
  await userEvent.fill(
    page.elementLocator(note.shadowRoot!.querySelector("input")!),
    "  Guests left  ",
  );
  await el.updateComplete;
  expect(button(el).disabled).toBe(false);
  await click(el, "[data-confirm]");
  expect(calls).toEqual([
    {
      cancellations: [
        {
          lineId: "flan",
          quantity: "1.000",
          expectedBillRevision: 7,
          expectedContext: dish("flan").context,
          refundHandoff: true,
          reasonId: "other",
          note: "Guests left",
        },
        {
          lineId: "croquetas",
          quantity: "2.000",
          expectedBillRevision: 7,
          expectedContext: dish("croquetas", "started").context,
          reasonId: "other",
          note: "Guests left",
        },
      ],
    },
  ]);
});
it("does not accept a reason that only allows comps", async () => {
  const el = await mount({ reasons: [{ ...house, actions: ["discount_percent"] }] });
  await reason(el);
  button(el).click();
  await el.updateComplete;
  expect(button(el).disabled).toBe(true);
  expect(root(el).querySelector("wt-combobox")!.options).toEqual([]);
});
it("keeps an unchanged choice usable after a server refusal", async () => {
  const el = await mount();
  await reason(el);
  const calls = collect(el);
  await click(el, "[data-confirm]");
  el.refusal = "Try again";
  await el.updateComplete;
  expect(button(el).disabled).toBe(false);
  expect(root(el).querySelector("wt-form-actions")!.error).toBe("Try again");
  await click(el, "[data-confirm]");
  expect(calls).toHaveLength(2);
});
it("refreshing consent discards the old choice and refuses a click before the refreshed render", async () => {
  const el = await mount();
  await reason(el);
  const calls = collect(el);
  el.dishes = [{ ...dish("flan"), billRevision: 9, quantity: "2.000" }];
  button(el).click();
  await el.updateComplete;
  expect(calls).toEqual([]);
  expect(button(el).disabled).toBe(true);
  expect(root(el).querySelector("wt-combobox")!.value).toBe("");
});
it("blocks empty and busy confirmations, including direct host activation", async () => {
  const el = await mount({ dishes: [], defaultReasonId: "house" });
  const calls = collect(el);
  button(el).click();
  await el.updateComplete;
  expect(calls).toEqual([]);
  el.dishes = [dish("flan")];
  el.busy = true;
  await el.updateComplete;
  button(el).click();
  expect(calls).toEqual([]);
  await button(el).updateComplete;
  expect(button(el).shadowRoot!.querySelector("button")!.getAttribute("aria-busy")).toBe("true");
});
it("Back closes without emitting a cancellation and leaves no registered dialog", async () => {
  const el = await mount();
  const calls = collect(el);
  let closes = 0;
  el.addEventListener("finish-table-close", () => closes++);
  await click(el, "[data-close]");
  await expect.poll(() => closes).toBe(1);
  expect(calls).toEqual([]);
  expect(dialogOpenUnder(el)).toBe(false);
});

it("retries a failed reason read only while the live dialog can ask", async () => {
  const el = await mount({ reasons: null });
  let reads = 0;
  el.addEventListener("finish-table-reasons", () => reads++);
  await click(el, "[data-retry]");
  expect(reads).toBe(1);
  el.reasonsLoading = true;
  await el.updateComplete;
  root(el).querySelector<HTMLElement>("[data-retry]")!.click();
  expect(reads).toBe(1);
  expect(button(el).disabled).toBe(true);
  el.reasonsLoading = false;
  await el.updateComplete;
  const closed = new Promise<void>((resolve) =>
    el.addEventListener("finish-table-close", () => resolve(), { once: true }),
  );
  await click(el, "[data-close]");
  await closed;
  await expect.poll(() => root(el).querySelector("wt-dialog")!.open).toBe(false);
  root(el).querySelector<HTMLElement>("[data-retry]")!.click();
  expect(reads).toBe(1);
});
it("drops a deleted reason and its note after the configured list changes", async () => {
  const el = await mount();
  await reason(el, "other");
  const field = root(el).querySelector("wt-input")!;
  await field.updateComplete;
  await userEvent.fill(
    page.elementLocator(field.shadowRoot!.querySelector("input")!),
    "Guests left",
  );
  el.reasons = [house];
  await el.updateComplete;
  expect(root(el).querySelector("wt-combobox")!.value).toBe("");
  expect(root(el).querySelector("wt-input")).toBeNull();
  expect(button(el).disabled).toBe(true);
});
it("cannot dispatch a choice from a detached or closed dialog", async () => {
  const el = await mount({ defaultReasonId: "house" });
  const calls = collect(el);
  el.remove();
  button(el).click();
  expect(calls).toEqual([]);
  document.body.appendChild(el);
  await el.updateComplete;
  await click(el, "[data-close]");
  await expect.poll(() => root(el).querySelector("wt-dialog")!.open).toBe(false);
  button(el).click();
  expect(calls).toEqual([]);
  el.remove();
});
it("ignores bubbled close events from a nested control", async () => {
  const el = await mount();
  let closes = 0;
  el.addEventListener("finish-table-close", () => closes++);
  root(el)
    .querySelector("wt-combobox")!
    .dispatchEvent(new CustomEvent("wt-close", { bubbles: true, composed: true }));
  await el.updateComplete;
  expect(closes).toBe(0);
  expect(root(el).querySelector("wt-dialog")!.open).toBe(true);
});
it("keeps the confirmation busy until the parent clears its own in-flight state", async () => {
  const el = await mount({ defaultReasonId: "house" });
  const calls = collect(el);
  await click(el, "[data-confirm]");
  el.busy = true;
  await el.updateComplete;
  await button(el).updateComplete;
  expect(button(el).shadowRoot!.querySelector("button")!.getAttribute("aria-busy")).toBe("true");
  await reason(el, "other");
  expect(root(el).querySelector("wt-combobox")!.value).toBe("house");
  el.busy = false;
  await el.updateComplete;
  expect(button(el).disabled).toBe(false);
  await click(el, "[data-confirm]");
  expect(calls).toHaveLength(2);
});

it("locks the unanswered fields while keeping the same confirmation available for retry", async () => {
  const el = await mount();
  await reason(el);
  const locked = el as typeof el & { confirmationLocked: boolean };
  locked.confirmationLocked = true;
  el.requestUpdate();
  await el.updateComplete;
  expect(
    root(el).querySelector<HTMLElementTagNameMap["wt-combobox"]>('wt-combobox[name="reason"]')!
      .disabled,
  ).toBe(true);
  expect(root(el).querySelector<HTMLInputElement>('input[name="refund"]')!.disabled).toBe(true);
  expect(button(el).disabled).toBe(false);
  const calls = collect(el);
  await click(el, "[data-confirm]");
  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatchObject({
    cancellations: [expect.objectContaining({ refundHandoff: true }), expect.any(Object)],
  });
});
