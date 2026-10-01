import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { formatMoney } from "@waitron/shared";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { currentLocale, setLocale, t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
import "./unpaid-departure-dialog.js";
import type { DepartingBill, TillUnpaidDepartureDialog } from "./unpaid-departure-dialog.js";

afterEach(cleanupWidgets);
beforeEach(() => setLocale("en"));

const owing: DepartingBill[] = [
  { workingOrderId: "wo-4", name: "4 · Bill 1", outstanding: "14.00" },
  { workingOrderId: "wo-check", name: "4 · Bill 2", outstanding: "30.00" },
];

async function mount(over: Partial<TillUnpaidDepartureDialog> = {}) {
  const { el } = await mountWidget<TillUnpaidDepartureDialog>("till-unpaid-departure-dialog", {
    bills: owing,
    ...over,
  });
  return el;
}

const root = (el: TillUnpaidDepartureDialog) => el.shadowRoot!;
const text = (node: Element | null) => (node?.textContent ?? "").replace(/[ \n\t]+/g, " ").trim();
const money = (amount: string) => formatMoney(amount, currentLocale());
const reason = (el: TillUnpaidDepartureDialog) =>
  root(el).querySelector<HTMLElement & { error: string; required: boolean }>(
    'wt-input[name="reason"]',
  )!;
const actions = (el: TillUnpaidDepartureDialog) =>
  root(el).querySelector<HTMLElement & { error: string }>("wt-form-actions")!;
const confirm = (el: TillUnpaidDepartureDialog) =>
  root(el).querySelector<HTMLElement & { disabled: boolean; loading: boolean }>(
    "[data-departure-confirm]",
  )!;

async function type(el: TillUnpaidDepartureDialog, value: string): Promise<void> {
  const input = reason(el).shadowRoot!.querySelector("input")!;
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  await el.updateComplete;
}

async function press(el: TillUnpaidDepartureDialog): Promise<void> {
  confirm(el).click();
  await el.updateComplete;
}

function capture<T>(el: TillUnpaidDepartureDialog, type: string): T[] {
  const seen: T[] = [];
  el.addEventListener(type, (event) => seen.push((event as CustomEvent<T>).detail));
  return seen;
}

describe("till-unpaid-departure-dialog: what it will do", () => {
  it("lists each bill left unpaid with its amount, the total, and what happens to them and the table", async () => {
    const el = await mount();

    const rows = [...root(el).querySelectorAll("[data-departure-bill]")].map(text);
    expect(rows).toEqual([`4 · Bill 1 ${money("14.00")}`, `4 · Bill 2 ${money("30.00")}`]);
    expect(text(root(el).querySelector("[data-departure-total]"))).toBe(
      `${t("departure.left_unpaid")} ${money("44.00")}`,
    );
    expect(text(root(el).querySelector("[data-departure-scope]"))).toBe(t("departure.scope"));
    expect(text(confirm(el))).toBe(t("departure.confirm").replace("{amount}", money("44.00")));
  });

  it("says a supervisor or manager may be asked to approve it next", async () => {
    const el = await mount();

    expect(text(root(el).querySelector("[data-departure-next]"))).toBe(
      t("departure.approval_next"),
    );
  });

  it("speaks Spanish", async () => {
    setLocale("es");
    const el = await mount();

    expect(text(root(el).querySelector("[data-departure-scope]"))).toBe(
      "Cada una de estas cuentas se factura ahora por completo y queda registrada como no pagada. No se imprime ticket. Después se cierra la mesa, como con Cerrar mesa.",
    );
    expect(text(confirm(el))).toBe(`Registrar ${money("44.00")} sin pagar`);
  });
});

describe("till-unpaid-departure-dialog: the reason", () => {
  it("sends the reason typed, trimmed", async () => {
    const el = await mount();
    const asked = capture<{ reason: string }>(el, "unpaid-departure-continue");

    await type(el, "  Left while we cleared the terrace ");
    await press(el);

    expect(asked).toEqual([{ reason: "Left while we cleared the terrace" }]);
  });

  it("marks the reason required, says it under the field and above the action, and sends nothing", async () => {
    const el = await mount();
    const asked = capture(el, "unpaid-departure-continue");

    expect(reason(el).required).toBe(true);
    await type(el, "   ");
    await press(el);

    expect(asked).toEqual([]);
    expect(reason(el).error).toBe(t("departure.reason_invalid"));
    expect(actions(el).error).toBe(t("form.fix_fields"));
    expect(confirm(el).disabled).toBe(true);
    await type(el, "x".repeat(501));
    expect(reason(el).error).toBe(t("departure.reason_long"));
    await type(el, "Ran off");
    expect(reason(el).error).toBe("");
    expect(actions(el).error).toBe("");
    expect(confirm(el).disabled).toBe(false);
  });

  it("continues on Enter in the reason", async () => {
    const el = await mount();
    const asked = capture(el, "unpaid-departure-continue");
    await type(el, "Ran off");

    reason(el)
      .shadowRoot!.querySelector("input")!
      .dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true }));
    await el.updateComplete;

    expect(asked).toEqual([{ reason: "Ran off" }]);
  });
});

describe("till-unpaid-departure-dialog: refusals", () => {
  it.each(["unpaid_departure.unfired_dishes", "unpaid_departure.bill_holds_payment"])(
    "says %s in its own sentence above the action, beside no field",
    async (code) => {
      const el = await mount({ refusal: { code } });

      expect(actions(el).error).toBe(codeMessage(code));
      expect(reason(el).error).toBe("");
    },
  );

  it("puts a refusal of the reason beside the reason, until it is changed", async () => {
    const el = await mount({ refusal: { code: "management.request_invalid", field: "reason" } });

    expect(reason(el).error).toBe(codeMessage("management.request_invalid"));
    expect(actions(el).error).toBe(t("form.fix_fields"));
    await type(el, "Ran off");
    expect(reason(el).error).toBe("");
    expect(actions(el).error).toBe("");
  });

  it("says a departure that got no answer may have been recorded", async () => {
    const el = await mount({ refusal: { code: "network" } });

    expect(actions(el).error).toBe(t("departure.unconfirmed"));
  });

  it("says who can approve it could not be read", async () => {
    const el = await mount({ refusal: { code: "approvers" } });

    expect(actions(el).error).toBe(t("departure.approvers_failed"));
  });

  it("while a request is out, holds the action and cannot be dismissed", async () => {
    const el = await mount({ busy: true });

    expect(confirm(el).loading).toBe(true);
    expect(confirm(el).disabled).toBe(true);
    expect(
      root(el).querySelector<HTMLElement & { dismissible: boolean }>("wt-dialog")!.dismissible,
    ).toBe(false);
    expect(
      root(el).querySelector<HTMLElement & { disabled: boolean }>("[data-departure-close]")!
        .disabled,
    ).toBe(true);
  });

  it("Cancel asks to close", async () => {
    const el = await mount();
    const closed = capture(el, "unpaid-departure-close");

    root(el).querySelector<HTMLElement>("[data-departure-close]")!.click();

    expect(closed).toHaveLength(1);
  });
});
