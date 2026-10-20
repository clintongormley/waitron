import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { formatMoney } from "@waitron/shared";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { currentLocale, setLocale, t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
import "./presented-pay-dialog.js";
import type { PresentedPayDetail, TillPresentedPayDialog } from "./presented-pay-dialog.js";
import type { DeviceEquipment, EquipmentItem, RoleEquipment } from "../api/client.js";

afterEach(cleanupWidgets);
beforeEach(() => setLocale("es"));

function equipmentItem(
  id: string,
  name: string,
  extra: Partial<EquipmentItem> = {},
): EquipmentItem {
  return { id, name, portable: false, available: true, busy: false, heldBy: null, ...extra };
}
const LECTOR_2 = equipmentItem("r2", "Lector 2", { portable: true, provider: "sumup" });
const LECTOR_3 = equipmentItem("r3", "Lector 3", { portable: true, provider: "sumup" });
const BARRA = equipmentItem("p1", "Barra");

function roleOf(
  name: RoleEquipment["role"],
  chosen: EquipmentItem | null,
  choices: EquipmentItem[],
): RoleEquipment {
  return {
    role: name,
    selection: chosen === null ? "default" : "item",
    chosenId: chosen?.id ?? null,
    resolved:
      chosen === null
        ? null
        : {
            id: chosen.id,
            name: chosen.name,
            available: chosen.available,
            provider: chosen.provider,
          },
    chosen,
    default: null,
    choices,
  };
}

/** The phone's equipment with `reader` (none when null) and the Barra receipt printer chosen. */
function equipmentWith(reader: EquipmentItem | null): DeviceEquipment {
  return {
    roles: [
      roleOf("receipt", BARRA, [BARRA]),
      roleOf("card_terminal", reader, [LECTOR_2, LECTOR_3]),
    ],
  };
}

async function mount(over: Partial<TillPresentedPayDialog> = {}) {
  const { el } = await mountWidget<TillPresentedPayDialog>("till-presented-pay-dialog", {
    open: true,
    amount: "62.40",
    tableName: "Mesa 4",
    takesReaderCard: true,
    takesCash: true,
    takesManualCard: true,
    equipment: equipmentWith(LECTOR_2),
    ...over,
  });
  return el;
}

const root = (el: TillPresentedPayDialog) => el.shadowRoot!;
const text = (node: Element | ShadowRoot | null) =>
  (node?.textContent ?? "").replace(/\s+/g, " ").trim();
const money = (amount: string) => formatMoney(amount, currentLocale()).replace(/\s+/g, " ");
const field = (el: TillPresentedPayDialog, name: string) =>
  root(el).querySelector<HTMLElement & { error: string; required: boolean; value: string }>(
    `[name="${name}"]`,
  );
const actions = (el: TillPresentedPayDialog) =>
  root(el).querySelector<HTMLElement & { error: string }>("wt-form-actions")!;
const charge = (el: TillPresentedPayDialog) =>
  root(el).querySelector<HTMLElement & { disabled: boolean; loading: boolean }>(
    "[data-presented-pay-take]",
  )!;
const row = (el: TillPresentedPayDialog) =>
  root(el).querySelector<HTMLElement & { open: boolean; updateComplete: Promise<unknown> }>(
    "till-pay-equipment",
  );
const methods = (el: TillPresentedPayDialog) =>
  [...root(el).querySelectorAll<HTMLInputElement>('input[name="method"]')].map(
    (radio) => radio.value,
  );

async function type(el: TillPresentedPayDialog, name: string, value: string): Promise<void> {
  const input = field(el, name)!.shadowRoot!.querySelector("input")!;
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  await el.updateComplete;
}

async function pick(el: TillPresentedPayDialog, method: string): Promise<void> {
  root(el).querySelector<HTMLInputElement>(`input[name="method"][value="${method}"]`)!.click();
  await el.updateComplete;
}

async function take(el: TillPresentedPayDialog): Promise<void> {
  charge(el).click();
  await el.updateComplete;
}

function capture<T>(el: TillPresentedPayDialog, type: string): T[] {
  const seen: T[] = [];
  el.addEventListener(type, (event) => seen.push((event as CustomEvent<T>).detail));
  return seen;
}

describe("till-presented-pay-dialog: what it shows", () => {
  it("offers no way to split: only the whole amount, and the line that says so", async () => {
    const el = await mount();

    expect(root(el).querySelector('input[name="way"]')).toBeNull();
    expect(root(el).querySelector("[data-pay-way]")).toBeNull();
    expect(root(el).querySelector<HTMLElement & { heading: string }>("wt-dialog")!.heading).toBe(
      "Cobrar · Mesa 4",
    );
    expect(text(root(el).querySelector("[data-presented-pay-balance]"))).toBe(
      `Cuenta presentada ${money("62.40")}`,
    );
    expect(text(root(el).querySelector("[data-presented-pay-whole]"))).toBe(
      "Esta cuenta ya está presentada: se cobra entera, en un solo pago.",
    );
  });

  it("is closed while open is false", async () => {
    const el = await mount({ open: false });
    expect(root(el).querySelector<HTMLElement & { open: boolean }>("wt-dialog")!.open).toBe(false);
  });

  it("titles itself Cobrar alone without a table name", async () => {
    const el = await mount({ tableName: "" });
    expect(root(el).querySelector<HTMLElement & { heading: string }>("wt-dialog")!.heading).toBe(
      t("bill_pay.title"),
    );
  });

  it.each([
    [true, true, true, ["card", "cash", "manual"]],
    [false, true, true, ["cash", "manual"]],
    [true, false, false, ["card"]],
    [false, false, true, ["manual"]],
  ] as const)(
    "offers the methods the profile allows (card %s, cash %s, other %s)",
    async (takesReaderCard, takesCash, takesManualCard, shown) => {
      const el = await mount({ takesReaderCard, takesCash, takesManualCard });
      expect(methods(el)).toEqual(shown);
      expect(
        root(el).querySelector<HTMLInputElement>(`input[name="method"][value="${shown[0]}"]`)!
          .checked,
      ).toBe(true);
    },
  );

  it("with no method offered, says so and Cobrar stays disabled", async () => {
    const el = await mount({ takesReaderCard: false, takesCash: false, takesManualCard: false });
    const paid = capture(el, "presented-pay");

    expect(text(root(el).querySelector("[data-pay-no-method]"))).toBe(t("bill_pay.no_method"));
    expect(charge(el).disabled).toBe(true);
    expect(row(el)).toBeNull();
    await take(el);
    expect(paid).toEqual([]);
  });

  it("drops a method the profile stops offering for the first it still offers", async () => {
    const el = await mount();
    el.takesReaderCard = false;
    await el.updateComplete;
    expect(root(el).querySelector<HTMLInputElement>('input[value="cash"]')!.checked).toBe(true);
  });
});

describe("till-presented-pay-dialog: by card on the reader", () => {
  it("names Lector 2 and Barra in the closed row, and Cobrar charges the reader it names", async () => {
    const el = await mount();
    const paid = capture<PresentedPayDetail>(el, "presented-pay");

    await row(el)!.updateComplete;
    expect(row(el)!.open).toBe(false);
    expect(text(row(el)!.shadowRoot!.querySelector("[data-pay-equipment-summary]"))).toBe(
      "Lector 2 · ticket en Barra",
    );
    expect(text(charge(el))).toBe(`Cobrar ${money("62.40")} en Lector 2`);
    await take(el);
    expect(paid).toEqual([{ method: "card", readerId: "r2" }]);
  });

  it("charges the reader picked since, and its name follows", async () => {
    const el = await mount();
    const paid = capture<PresentedPayDetail>(el, "presented-pay");
    el.equipment = equipmentWith(LECTOR_3);
    await el.updateComplete;

    expect(text(charge(el))).toBe(`Cobrar ${money("62.40")} en Lector 3`);
    await take(el);
    expect(paid).toEqual([{ method: "card", readerId: "r3" }]);
  });

  it("with no reader, opens the row and disables Cobrar on Tarjeta; cash needs no reader", async () => {
    const el = await mount({ equipment: equipmentWith(null) });
    const paid = capture(el, "presented-pay");

    expect(row(el)!.open).toBe(true);
    expect(charge(el).disabled).toBe(true);
    expect(text(charge(el))).toBe(t("bill_pay.take"));
    await take(el);
    expect(paid).toEqual([]);

    await pick(el, "cash");
    expect(charge(el).disabled).toBe(false);
  });

  it("before the equipment is read, disables Cobrar on Tarjeta without opening the row", async () => {
    const el = await mount({ equipment: null });
    expect(charge(el).disabled).toBe(true);
    expect(row(el)!.open).toBe(false);

    el.equipment = equipmentWith(LECTOR_2);
    await el.updateComplete;
    expect(charge(el).disabled).toBe(false);
    expect(row(el)!.open).toBe(false);
  });

  it("opens the row when the reader goes while it is shown, and only the waiter closes it", async () => {
    const el = await mount();
    el.equipment = equipmentWith(null);
    await el.updateComplete;
    expect(row(el)!.open).toBe(true);

    el.equipment = equipmentWith(LECTOR_2);
    await el.updateComplete;
    expect(row(el)!.open).toBe(true);

    row(el)!.dispatchEvent(
      new CustomEvent("pay-equipment-toggle", { detail: { open: false }, bubbles: true }),
    );
    await el.updateComplete;
    expect(row(el)!.open).toBe(false);
  });

  it("keeps the row closed while the reader is being picked up by itself, then opens it only if none came", async () => {
    const picked = await mount({ equipment: equipmentWith(null), autoPicking: true });
    expect(row(picked)!.open).toBe(false);
    picked.equipment = equipmentWith(LECTOR_2);
    picked.autoPicking = false;
    await picked.updateComplete;
    expect(row(picked)!.open).toBe(false);
    picked.remove();

    const refused = await mount({ equipment: equipmentWith(null), autoPicking: true });
    expect(row(refused)!.open).toBe(false);
    refused.autoPicking = false;
    await refused.updateComplete;
    expect(row(refused)!.open).toBe(true);
  });

  it("starts the row closed again on each opening", async () => {
    const el = await mount({ equipment: equipmentWith(null) });
    expect(row(el)!.open).toBe(true);

    el.open = false;
    await el.updateComplete;
    el.equipment = equipmentWith(LECTOR_2);
    el.open = true;
    await el.updateComplete;
    expect(row(el)!.open).toBe(false);

    el.open = false;
    await el.updateComplete;
    el.equipment = equipmentWith(null);
    el.open = true;
    await el.updateComplete;
    expect(row(el)!.open).toBe(true);
  });

  it("on a practice venue charges the demo reader before any equipment read", async () => {
    const el = await mount({ equipment: null, fixedReader: { id: "sim-1", name: "Demo" } });
    const paid = capture<PresentedPayDetail>(el, "presented-pay");

    expect(charge(el).disabled).toBe(false);
    expect(text(charge(el))).toBe(`Cobrar ${money("62.40")} en Demo`);
    await take(el);
    expect(paid).toEqual([{ method: "card", readerId: "sim-1" }]);
  });

  it("disables Cobrar while an equipment change is out, whatever the method", async () => {
    const el = await mount({ equipmentBusy: true });
    const paid = capture(el, "presented-pay");
    expect(charge(el).disabled).toBe(true);
    await take(el);
    expect(paid).toEqual([]);

    await pick(el, "cash");
    await type(el, "tendered", "70");
    expect(charge(el).disabled).toBe(true);

    el.equipmentBusy = false;
    await el.updateComplete;
    expect(charge(el).disabled).toBe(false);
  });

  it("lets the row's own events out", async () => {
    const el = await mount({ canScan: true });
    const scans = capture(el, "pay-equipment-qr");
    await row(el)!.updateComplete;
    row(el)!.shadowRoot!.querySelector<HTMLElement>("[data-pay-qr]")!.click();
    expect(scans).toHaveLength(1);
  });
});

describe("till-presented-pay-dialog: the row's QR", () => {
  afterEach(() => vi.restoreAllMocks());

  const scanner = (el: TillPresentedPayDialog) => root(el).querySelector("till-equipment-scanner");
  const stepper = (el: TillPresentedPayDialog) =>
    root(el).querySelector<HTMLElement & { value: string }>('wt-number-stepper[name="guests"]');

  async function typeGuests(el: TillPresentedPayDialog, value: string): Promise<void> {
    const input = stepper(el)!.shadowRoot!.querySelector("input")!;
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    input.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
    await el.updateComplete;
  }

  async function pressQr(el: TillPresentedPayDialog): Promise<void> {
    await row(el)!.updateComplete;
    row(el)!.shadowRoot!.querySelector<HTMLElement>("[data-pay-qr]")!.click();
    await el.updateComplete;
  }

  async function scanning(over: Partial<TillPresentedPayDialog> = {}) {
    vi.spyOn(navigator.mediaDevices, "getUserMedia").mockReturnValue(new Promise(() => {}));
    const el = await mount({ canScan: true, asksGuests: true, receiptGuests: 4, ...over });
    return el;
  }

  it("opens the camera in place of the form, for either kind of sticker", async () => {
    setLocale("es");
    const el = await scanning();
    await pressQr(el);

    expect(scanner(el)!.getAttribute("kind")).toBe("any");
    expect(text(root(el).querySelector("[data-pay-scan-heading]"))).toBe("Escanear código QR");
    expect(text(root(el).querySelector("[data-pay-scan-back]"))).toBe("Volver");
    expect(row(el)).toBeNull();
    expect(root(el).querySelector("[data-presented-pay-take]")).toBeNull();
    expect(methods(el)).toEqual([]);
  });

  it("Volver brings back the method, the cash handed over and the guests", async () => {
    const el = await scanning();
    await pick(el, "cash");
    await type(el, "tendered", "70");
    await typeGuests(el, "6");
    await pressQr(el);

    root(el).querySelector<HTMLElement>("[data-pay-scan-back]")!.click();
    await el.updateComplete;

    expect(scanner(el)).toBeNull();
    expect(root(el).querySelector<HTMLInputElement>('input[name="method"]:checked')!.value).toBe(
      "cash",
    );
    expect(field(el, "tendered")!.value).toBe("70");
    expect(stepper(el)!.value).toBe("6");
  });

  it("Volver keeps another machine's operation number", async () => {
    const el = await scanning();
    await pick(el, "manual");
    await type(el, "externalRef", "operation-17");
    await pressQr(el);

    root(el).querySelector<HTMLElement>("[data-pay-scan-back]")!.click();
    await el.updateComplete;

    expect(root(el).querySelector<HTMLInputElement>('input[name="method"]:checked')!.value).toBe(
      "manual",
    );
    expect(field(el, "externalRef")!.value).toBe("operation-17");
  });

  it("a sticker read sends its kind and id, and the form comes back", async () => {
    const el = await scanning();
    await pick(el, "cash");
    await type(el, "tendered", "70");
    await pressQr(el);
    const stickers = capture<unknown>(el, "pay-equipment-sticker");

    scanner(el)!.dispatchEvent(
      new CustomEvent("equipment-scanned", {
        detail: { id: "p1", kind: "printer" },
        bubbles: true,
        composed: true,
      }),
    );
    await el.updateComplete;

    expect(stickers).toEqual([{ kind: "printer", id: "p1" }]);
    expect(scanner(el)).toBeNull();
    expect(field(el, "tendered")!.value).toBe("70");
  });

  it("the locked sheet offers no QR", async () => {
    const el = await scanning({
      confirmation: { tender: { method: "cash", amount: "70.00" }, outstanding: "62.40" },
    });

    expect(row(el)).toBeNull();
    expect(root(el).querySelector("[data-pay-qr]")).toBeNull();
    expect(scanner(el)).toBeNull();
  });
});

describe("till-presented-pay-dialog: in cash and on another machine", () => {
  it("cash needs the cash handed over, at least the bill", async () => {
    const el = await mount();
    const paid = capture<PresentedPayDetail>(el, "presented-pay");
    await pick(el, "cash");

    expect(field(el, "tendered")!.required).toBe(true);
    expect(text(charge(el))).toBe("Cobrar");
    await take(el);
    expect(paid).toEqual([]);
    expect(field(el, "tendered")!.error).toBe(t("bill_pay.tendered_invalid"));
    expect(actions(el).error).toBe(t("form.fix_fields"));
    expect(charge(el).disabled).toBe(true);

    await type(el, "tendered", "50");
    expect(field(el, "tendered")!.error).toBe(t("bill_pay.tendered_short"));
    await type(el, "tendered", "70,00");
    expect(field(el, "tendered")!.error).toBe("");
    await take(el);
    expect(paid).toEqual([{ method: "cash", tendered: "70.00" }]);
  });

  it("Enter in the cash field takes the payment", async () => {
    const el = await mount({ takesReaderCard: false });
    const paid = capture<PresentedPayDetail>(el, "presented-pay");
    await type(el, "tendered", "70");
    field(el, "tendered")!
      .shadowRoot!.querySelector("input")!
      .dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true }));
    await el.updateComplete;
    expect(paid).toEqual([{ method: "cash", tendered: "70" }]);
  });

  it("with no amount yet, cash checks only the cash handed over", async () => {
    const el = await mount({ amount: "", takesReaderCard: false });
    const paid = capture<PresentedPayDetail>(el, "presented-pay");
    await type(el, "tendered", "70");
    await take(el);
    expect(paid).toEqual([{ method: "cash", tendered: "70" }]);
  });

  it("takes exactly the bill in cash", async () => {
    const el = await mount({ takesReaderCard: false });
    const paid = capture<PresentedPayDetail>(el, "presented-pay");
    await type(el, "tendered", "62,40");
    await take(el);
    expect(paid).toEqual([{ method: "cash", tendered: "62.40" }]);
  });

  it("Otro datáfono sends manual, with the operation number only when typed", async () => {
    const el = await mount();
    const paid = capture<PresentedPayDetail>(el, "presented-pay");
    await pick(el, "manual");

    expect(field(el, "externalRef")!.required).toBe(false);
    expect(row(el)).not.toBeNull();
    await take(el);
    await type(el, "externalRef", " 4821 ");
    await take(el);
    expect(paid).toEqual([{ method: "manual" }, { method: "manual", externalRef: "4821" }]);
  });

  it("Otro datáfono needs no reader", async () => {
    const el = await mount({ equipment: null });
    await pick(el, "manual");
    expect(charge(el).disabled).toBe(false);
  });
});

describe("till-presented-pay-dialog: the receipt's guests", () => {
  const stepper = (el: TillPresentedPayDialog) =>
    root(el).querySelector<HTMLElement & { value: string; error: string }>(
      'wt-number-stepper[name="guests"]',
    );

  async function typeGuests(el: TillPresentedPayDialog, value: string): Promise<void> {
    const input = stepper(el)!.shadowRoot!.querySelector("input")!;
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    input.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
    await el.updateComplete;
  }

  it("asks nothing when the venue does not", async () => {
    const el = await mount();
    expect(stepper(el)).toBeNull();
  });

  it("shows the guests field starting on the seated count, and its value travels", async () => {
    const el = await mount({ asksGuests: true, receiptGuests: 4 });
    const paid = capture<PresentedPayDetail>(el, "presented-pay");

    expect(stepper(el)!.value).toBe("4");
    await take(el);
    await typeGuests(el, "6");
    await pick(el, "manual");
    await take(el);
    await typeGuests(el, "");
    await pick(el, "cash");
    await type(el, "tendered", "70");
    await take(el);
    expect(paid).toEqual([
      { method: "card", readerId: "r2", guests: 4 },
      { method: "manual", guests: 6 },
      { method: "cash", tendered: "70", guests: null },
    ]);
  });

  it("an invalid count is marked and nothing is asked", async () => {
    const el = await mount({ asksGuests: true });
    const paid = capture(el, "presented-pay");
    await typeGuests(el, "abc");
    await take(el);

    expect(paid).toEqual([]);
    expect(stepper(el)!.error).toBe(t("seat.guest_count_invalid"));
    expect(actions(el).error).toBe(t("form.fix_fields"));
  });
});

describe("till-presented-pay-dialog: refusals, busy and closing", () => {
  it("a refusal that names no shown field shows above the action, and never disables it", async () => {
    const el = await mount({ refusal: { code: "order.payment_in_flight" } });
    expect(actions(el).error).toBe(codeMessage("order.payment_in_flight"));
    expect(charge(el).disabled).toBe(false);
  });

  it("a refusal naming the cash field shows under it, and goes once the field changes", async () => {
    const el = await mount({
      takesReaderCard: false,
      refusal: { code: "management.request_invalid", field: "tendered" },
    });
    expect(field(el, "tendered")!.error).toBe(codeMessage("management.request_invalid"));
    expect(actions(el).error).toBe(t("form.fix_fields"));

    await type(el, "tendered", "70");
    expect(field(el, "tendered")!.error).toBe("");
    expect(actions(el).error).toBe("");
  });

  it("a refusal naming the guests shows under the guests field", async () => {
    const el = await mount({
      asksGuests: true,
      refusal: { code: "management.request_invalid", field: "guests" },
    });
    expect(
      root(el).querySelector<HTMLElement & { error: string }>('wt-number-stepper[name="guests"]')!
        .error,
    ).toBe(codeMessage("management.request_invalid"));
    expect(actions(el).error).toBe(t("form.fix_fields"));
  });

  it("a refusal naming the operation number shows under it on Otro datáfono", async () => {
    const el = await mount({
      refusal: { code: "management.request_invalid", field: "externalRef" },
    });
    expect(actions(el).error).toBe(codeMessage("management.request_invalid"));

    await pick(el, "manual");
    expect(field(el, "externalRef")!.error).toBe(codeMessage("management.request_invalid"));
    await type(el, "externalRef", "4821");
    expect(field(el, "externalRef")!.error).toBe("");
  });

  it("a refusal naming a field not shown goes above the action", async () => {
    const el = await mount({ refusal: { code: "management.request_invalid", field: "guests" } });
    expect(actions(el).error).toBe(codeMessage("management.request_invalid"));
  });

  it.each([
    ["sale.unconfirmed", "sale.unconfirmed"],
    ["sale.refused", "sale.refused"],
    ["bill.pay_with_bill_payments", "bill.pay_with_bill_payments"],
    ["declined", "bill_pay.card_declined"],
    ["network", "bill_pay.unconfirmed"],
  ] as const)("words the till's own refusal %s in its own sentence", async (code, key) => {
    const el = await mount({ refusal: { code } });
    expect(actions(el).error).toBe(t(key));
    expect(actions(el).error).not.toBe(codeMessage("no.such.code"));
  });

  it("words a person who may not take payments as the till does", async () => {
    const el = await mount({
      refusal: { code: "authorization.not_permitted", permission: "sale.take_payment" },
    });
    expect(actions(el).error).toBe(t("take_payment.not_permitted"));
  });

  it("words a device not set up for the card reader as the till does", async () => {
    const el = await mount({ refusal: { code: "device.forbidden_action", action: "pay" } });
    expect(actions(el).error).toBe(t("card_reader.not_set_up"));
  });

  it("a new request clears the refusal shown", async () => {
    const el = await mount({ refusal: { code: "order.payment_in_flight" } });
    await take(el);
    expect(actions(el).error).toBe("");
  });

  it("while busy, Cobrar is loading and nothing more is asked", async () => {
    const el = await mount({ busy: true });
    const paid = capture(el, "presented-pay");
    expect(charge(el).loading).toBe(true);
    expect(charge(el).disabled).toBe(true);
    await take(el);
    expect(paid).toEqual([]);
  });

  it("Cerrar asks the app to close the sheet", async () => {
    const el = await mount();
    const closed = capture(el, "presented-pay-close");
    const shut = new Promise<void>((resolve) =>
      root(el)
        .querySelector("wt-dialog")!
        .addEventListener("wt-close", () => resolve(), {
          once: true,
        }),
    );
    root(el).querySelector<HTMLElement>("[data-presented-pay-close]")!.click();
    await shut;
    expect(closed).toEqual([{}]);
  });

  it("asks nothing to close while a payment is sent", async () => {
    const el = await mount({ busy: true });
    const closed = capture(el, "presented-pay-close");
    root(el)
      .querySelector("wt-dialog")!
      .dispatchEvent(new CustomEvent("wt-close", { bubbles: true, composed: true }));
    expect(closed).toEqual([]);
  });

  it("speaks English too", async () => {
    setLocale("en");
    const el = await mount();
    expect(text(root(el).querySelector("[data-presented-pay-balance]"))).toBe(
      `Bill presented ${money("62.40")}`,
    );
    expect(text(root(el).querySelector("[data-presented-pay-whole]"))).toBe(
      "This bill has already been presented: it is paid whole, in one payment.",
    );
  });
});

describe("till-presented-pay-dialog: locked on a payment with no answer", () => {
  const cash = { tender: { method: "cash" as const, amount: "70.00" }, outstanding: "62.40" };
  const manual = {
    tender: { method: "card" as const, amount: "62.40", externalRef: "operation-17" },
    outstanding: "62.40",
    guests: 4,
  };
  const resend = (el: TillPresentedPayDialog) =>
    root(el).querySelector<HTMLElement & { disabled: boolean; loading: boolean }>(
      "[data-presented-pay-resend]",
    );
  const radios = (el: TillPresentedPayDialog) => [
    ...root(el).querySelectorAll<HTMLInputElement>('input[name="method"]'),
  ];
  const stepper = (el: TillPresentedPayDialog) =>
    root(el).querySelector<HTMLElement & { value: string; disabled: boolean }>(
      'wt-number-stepper[name="guests"]',
    );

  it("shows the cash payment sent: its method alone, fixed, the bill, the cash and the change", async () => {
    const el = await mount({ confirmation: cash, amount: "62.40" });

    expect(radios(el).map((radio) => [radio.value, radio.checked])).toEqual([["cash", true]]);
    expect(root(el).querySelector<HTMLFieldSetElement>("[data-pay-method]")!.disabled).toBe(true);
    expect(text(root(el).querySelector("[data-presented-pay-balance] dd"))).toBe(money("62.40"));
    expect(text(root(el).querySelector("[data-presented-pay-tendered]"))).toBe(money("70.00"));
    expect(text(root(el).querySelector("[data-presented-pay-change]"))).toBe(money("7.60"));
    expect(field(el, "tendered")).toBeNull();
    expect(field(el, "externalRef")).toBeNull();
    expect(stepper(el)).toBeNull();
  });

  it("shows another machine's operation number and the guests, both disabled", async () => {
    const el = await mount({ confirmation: manual, asksGuests: true, receiptGuests: 9 });

    expect(radios(el).map((radio) => [radio.value, radio.checked])).toEqual([["manual", true]]);
    const ref = root(el).querySelector<HTMLElement & { value: string; disabled: boolean }>(
      '[name="externalRef"]',
    )!;
    expect(ref.value).toBe("operation-17");
    expect(ref.disabled).toBe(true);
    expect(stepper(el)!.value).toBe("4");
    expect(stepper(el)!.disabled).toBe(true);
    expect(root(el).querySelector("[data-presented-pay-tendered]")).toBeNull();
  });

  it("names the original method even when the profile no longer offers it", async () => {
    const el = await mount({ confirmation: cash, takesCash: false });
    expect(radios(el).map((radio) => radio.value)).toEqual(["cash"]);
  });

  it("draws no reader and printer row, no Cobrar, and says the payment is unconfirmed", async () => {
    const el = await mount({ confirmation: cash });

    expect(row(el)).toBeNull();
    expect(root(el).querySelector("[data-presented-pay-take]")).toBeNull();
    expect(text(root(el).querySelector('[role="status"]'))).toBe(t("sale.unconfirmed"));
    expect(text(resend(el))).toBe(t("action.confirm_payment"));
    expect(resend(el)!.disabled).toBe(false);
  });

  it("its one action asks to send the payment again, and nothing else", async () => {
    const el = await mount({ confirmation: cash });
    const again = capture(el, "presented-pay-resend");
    const paid = capture(el, "presented-pay");

    resend(el)!.click();
    await el.updateComplete;
    expect(again).toEqual([{}]);
    expect(paid).toEqual([]);
  });

  it("while busy, the action is loading, asks nothing, and the status line steps aside", async () => {
    const el = await mount({ confirmation: cash, busy: true });
    const again = capture(el, "presented-pay-resend");

    expect(resend(el)!.loading).toBe(true);
    expect(resend(el)!.disabled).toBe(true);
    expect(root(el).querySelector('[role="status"]')).toBeNull();
    resend(el)!.click();
    await el.updateComplete;
    expect(again).toEqual([]);
  });

  it("a refusal shows above the action, even one naming a field, and never disables it", async () => {
    const el = await mount({
      confirmation: cash,
      refusal: { code: "order.payment_in_flight", field: "tendered" },
    });
    expect(actions(el).error).toBe(codeMessage("order.payment_in_flight"));
    expect(resend(el)!.disabled).toBe(false);
  });

  it("unlocks on the first method offered, with nothing typed, once the payment is let go", async () => {
    const el = await mount({ confirmation: manual });
    el.confirmation = undefined;
    await el.updateComplete;

    expect(methods(el)).toEqual(["card", "cash", "manual"]);
    expect(root(el).querySelector<HTMLInputElement>('input[value="card"]')!.checked).toBe(true);
    expect(root(el).querySelector<HTMLFieldSetElement>("[data-pay-method]")!.disabled).toBe(false);
    expect(resend(el)).toBeNull();
    expect(charge(el)).not.toBeNull();
    expect(row(el)).not.toBeNull();
    await pick(el, "manual");
    expect(field(el, "externalRef")!.value).toBe("");
  });
});

describe("till-presented-pay-dialog: the card at the table (A796)", () => {
  const waiting = (el: TillPresentedPayDialog) => root(el).querySelector("till-card-waiting");
  const inWaiting = (el: TillPresentedPayDialog, selector: string) =>
    text(waiting(el)?.shadowRoot?.querySelector(selector) ?? null);
  const waitingOn = (reader: string) =>
    t("bill_pay.waiting_on")
      .replace("{amount}", () => money("62.40"))
      .replace("{reader}", () => reader)
      .replace(/\s+/g, " ");

  afterEach(() => {
    vi.useRealTimers();
  });

  async function sent() {
    const el = await mount();
    const paid = capture<PresentedPayDetail>(el, "presented-pay");
    vi.useFakeTimers();
    await take(el);
    el.busy = true;
    await el.updateComplete;
    await waiting(el)?.updateComplete;
    return { el, paid };
  }

  it("shows the same panel while the card is at the reader, naming the reader it was sent to", async () => {
    const { el } = await sent();

    expect(inWaiting(el, "[data-pay-collecting]")).toBe(t("card.collecting"));
    expect(inWaiting(el, "[data-pay-waiting-on]")).toBe(waitingOn("Lector 2"));
    expect(root(el).querySelector("wt-button")).toBeNull();

    el.equipment = equipmentWith(LECTOR_3);
    await el.updateComplete;
    await vi.advanceTimersByTimeAsync(12_000);
    await waiting(el)!.updateComplete;
    expect(inWaiting(el, "[data-pay-waiting-on]")).toBe(waitingOn("Lector 2"));
    expect(inWaiting(el, "[data-pay-waiting-since]")).toBe(
      t("bill_pay.waiting_since").replace("{time}", "0:12"),
    );
  });

  it("stops its clock when the send ends, and when the sheet goes", async () => {
    const { el } = await sent();
    expect(vi.getTimerCount()).toBe(1);
    el.busy = false;
    await el.updateComplete;
    expect(waiting(el)).toBeNull();
    expect(vi.getTimerCount()).toBe(0);

    const again = await sent();
    again.el.remove();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("after a decline, retries on the phone's reader now, as Reintentar en Lector 3", async () => {
    const { el, paid } = await sent();
    el.equipment = equipmentWith(LECTOR_3);
    el.busy = false;
    el.refusal = { code: "declined" };
    await el.updateComplete;

    expect(actions(el).error).toBe(t("bill_pay.card_declined"));
    expect(text(charge(el))).toBe(
      t("bill_pay.retry_on_reader").replace("{reader}", () => "Lector 3"),
    );
    await take(el);
    expect(paid).toEqual([
      { method: "card", readerId: "r2" },
      { method: "card", readerId: "r3" },
    ]);
  });

  it("shows a tap's notice under the panel while the card is at the reader", async () => {
    const { el } = await sent();
    el.notice = { message: t("equipment.picked_up").replace("{item}", "Lector 3"), tone: "info" };
    await el.updateComplete;

    expect(waiting(el)).not.toBeNull();
    expect(text(root(el).querySelector("[data-pay-notice]"))).toBe(
      t("equipment.picked_up").replace("{item}", "Lector 3"),
    );
  });

  it("a cash payment out shows no panel", async () => {
    const el = await mount();
    await pick(el, "cash");
    await type(el, "tendered", "70");
    await take(el);
    el.busy = true;
    await el.updateComplete;
    expect(waiting(el)).toBeNull();
    expect(charge(el).loading).toBe(true);
  });
});

describe("till-presented-pay-dialog: the buttons stay in view at the sheet's foot", () => {
  afterEach(() => page.viewport(1280, 900));

  const tall = () => ({
    asksGuests: true,
    receiptGuests: 4,
    readerReason: t("bill_pay.reader_not_held_unknown"),
    readerHint: t("bill_pay.reader_not_held"),
    notice: { message: t("bill_pay.reader_not_held"), tone: "info" as const },
    refusal: { code: "order.payment_in_flight" },
  });

  /** `selector` sits in a footer row inside the dialog's visible box, with the body scrolling
   * above it when `scrolls`. */
  async function expectInView(
    el: TillPresentedPayDialog,
    selector: string,
    scrolls = true,
  ): Promise<void> {
    const dialog = root(el).querySelector("wt-dialog")!;
    await dialog.updateComplete;
    const native = dialog.shadowRoot!.querySelector("dialog")!;
    const body = dialog.shadowRoot!.querySelector<HTMLElement>(".body")!;
    expect(window.innerWidth).toBe(390);
    if (scrolls) expect(body.scrollHeight).toBeGreaterThan(body.clientHeight);
    const target = root(el).querySelector<HTMLElement>(selector)!;
    const box = target.getBoundingClientRect();
    const frame = native.getBoundingClientRect();
    expect(box.top).toBeGreaterThanOrEqual(frame.top);
    expect(box.bottom).toBeLessThanOrEqual(frame.bottom);
    expect(target.closest("wt-form-actions")!.slot).toBe("footer");
  }

  it("the form's Cobrar, under the reader's refusal and a refusal in Spanish", async () => {
    await page.viewport(390, 900);
    const el = await mount(tall());
    await row(el)!.updateComplete;
    row(el)!.shadowRoot!.querySelector<HTMLElement>("[data-pay-equipment-change]")!.click();
    await el.updateComplete;

    await expectInView(el, "[data-presented-pay-take]");
  });

  // At 900 the locked sheet's body fits; a phone the height of an iPhone SE's screen scrolls it.
  it("the locked sheet's Confirm payment, under a refusal in Spanish, on a short phone", async () => {
    await page.viewport(390, 667);
    const el = await mount({
      ...tall(),
      confirmation: {
        tender: { method: "card", amount: "62.40", externalRef: "A-1" },
        outstanding: "62.40",
        guests: 4,
      },
    });

    await expectInView(el, "[data-presented-pay-resend]");
  });

  it("the camera's Volver", async () => {
    await page.viewport(390, 900);
    vi.spyOn(navigator.mediaDevices, "getUserMedia").mockReturnValue(new Promise(() => {}));
    const el = await mount({ canScan: true });
    await row(el)!.updateComplete;
    row(el)!.shadowRoot!.querySelector<HTMLElement>("[data-pay-qr]")!.click();
    await el.updateComplete;

    await expectInView(el, "[data-pay-scan-back]", false);
  });
});
