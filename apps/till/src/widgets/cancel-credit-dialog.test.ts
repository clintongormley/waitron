import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { formatMoney } from "@waitron/shared";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { currentLocale, setLocale, t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
import "./cancel-credit-dialog.js";
import type { TillCancelCreditDialog } from "./cancel-credit-dialog.js";

afterEach(cleanupWidgets);
beforeEach(() => setLocale("en"));

async function mount(over: Partial<TillCancelCreditDialog> = {}) {
  const { el } = await mountWidget<TillCancelCreditDialog>("till-cancel-credit-dialog", {
    invoiceNumber: "A/12",
    amount: "24.50",
    ...over,
  });
  return el;
}

const root = (el: TillCancelCreditDialog) => el.shadowRoot!;
const text = (node: Element | null) => (node?.textContent ?? "").replace(/[ \n\t]+/g, " ").trim();
const money = (amount: string) => formatMoney(amount, currentLocale());
const reason = (el: TillCancelCreditDialog) =>
  root(el).querySelector<HTMLElement & { error: string; required: boolean }>(
    'wt-input[name="reason"]',
  );
const actions = (el: TillCancelCreditDialog) =>
  root(el).querySelector<HTMLElement & { error: string }>("wt-form-actions")!;
const confirm = (el: TillCancelCreditDialog) =>
  root(el).querySelector<HTMLElement & { disabled: boolean; loading: boolean }>(
    "[data-cancel-credit-confirm]",
  )!;

async function type(el: TillCancelCreditDialog, value: string): Promise<void> {
  const input = reason(el)!.shadowRoot!.querySelector("input")!;
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  await el.updateComplete;
}

async function press(el: TillCancelCreditDialog): Promise<void> {
  confirm(el).click();
  await el.updateComplete;
}

function capture<T>(el: TillCancelCreditDialog, type: string): T[] {
  const seen: T[] = [];
  el.addEventListener(type, (event) => seen.push((event as CustomEvent<T>).detail));
  return seen;
}

describe("till-cancel-credit-dialog: what it will do", () => {
  it("names the invoice and its amount, and says a credit note is issued and the bill cancelled", async () => {
    const el = await mount();

    expect(text(root(el).querySelector("[data-cancel-credit-scope]"))).toBe(
      `Invoice A/12 (${money("24.50")}) will be credited in full: a credit note is issued and the bill is cancelled.`,
    );
    expect(text(confirm(el))).toBe(t("cancel_credit.confirm"));
    expect(text(root(el).querySelector("[data-cancel-credit-next]"))).toBe(
      t("cancel_credit.approval_next"),
    );
  });

  it("offers to keep the bill rather than a second Cancel beside Cancel and credit", async () => {
    const el = await mount();
    const keep = root(el).querySelector("[data-cancel-credit-close]");

    expect(text(keep)).toBe("Keep the bill");
  });

  it("says the same of an invoice whose number it was not given", async () => {
    const el = await mount({ invoiceNumber: null });

    expect(text(root(el).querySelector("[data-cancel-credit-scope]"))).toBe(
      `This bill's invoice (${money("24.50")}) will be credited in full: a credit note is issued and the bill is cancelled.`,
    );
  });

  it("speaks Spanish", async () => {
    setLocale("es");
    const el = await mount();

    expect(text(root(el).querySelector("[data-cancel-credit-scope]"))).toBe(
      `La factura A/12 (${money("24.50")}) se abona por completo: se emite una factura rectificativa y se cancela la cuenta.`,
    );
    expect(text(confirm(el))).toBe("Cancelar y abonar");
    expect(text(root(el).querySelector("[data-cancel-credit-close]"))).toBe("Mantener la cuenta");
  });
});

describe("till-cancel-credit-dialog: the reason", () => {
  it("sends the reason typed, trimmed", async () => {
    const el = await mount();
    const asked = capture<{ reason: string }>(el, "cancel-credit-continue");

    await type(el, "  Charged to the wrong table ");
    await press(el);

    expect(asked).toEqual([{ reason: "Charged to the wrong table" }]);
  });

  it("marks the reason required, says it under the field and above the action, and sends nothing", async () => {
    const el = await mount();
    const asked = capture(el, "cancel-credit-continue");

    expect(reason(el)!.required).toBe(true);
    await type(el, "   ");
    await press(el);

    expect(asked).toEqual([]);
    expect(reason(el)!.error).toBe(t("cancel_credit.reason_invalid"));
    expect(actions(el).error).toBe(t("form.fix_fields"));
    expect(confirm(el).disabled).toBe(true);
    await type(el, "x".repeat(501));
    expect(reason(el)!.error).toBe(t("cancel_credit.reason_long"));
    await type(el, "Wrong table");
    expect(reason(el)!.error).toBe("");
    expect(actions(el).error).toBe("");
    expect(confirm(el).disabled).toBe(false);
  });

  it("continues on Enter in the reason", async () => {
    const el = await mount();
    const asked = capture(el, "cancel-credit-continue");
    await type(el, "Wrong table");

    reason(el)!
      .shadowRoot!.querySelector("input")!
      .dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true }));
    await el.updateComplete;

    expect(asked).toEqual([{ reason: "Wrong table" }]);
  });
});

describe("till-cancel-credit-dialog: refusals", () => {
  it.each([
    ["bill.payments_received", "cancel_credit.refused_payments"],
    ["order.payment_in_flight", "cancel_credit.refused_payment_in_flight"],
    ["authorization.not_permitted", "cancel_credit.refused_not_permitted"],
    ["network", "cancel_credit.unconfirmed"],
    ["approvers", "cancel_credit.approvers_failed"],
  ] as const)(
    "says %s in its own sentence above the action, beside no field",
    async (code, key) => {
      const el = await mount({ refusal: { code } });

      expect(actions(el).error).toBe(t(key));
      expect(reason(el)!.error).toBe("");
    },
  );

  it.each([
    "working_order.not_placed",
    "series.no_rectificative_for_node",
    "device.unauthorized",
    "sale.correction_exceeds_total",
    "sale.correction_not_whole",
    "server.internal",
    "some.unmapped_code",
  ])("says %s in the shared message for its code, beside no field", async (code) => {
    const el = await mount({ refusal: { code } });

    expect(actions(el).error).toBe(codeMessage(code));
    expect(reason(el)!.error).toBe("");
  });

  it("says each cancel refusal in Spanish too", async () => {
    setLocale("es");
    const own = await mount({ refusal: { code: "bill.payments_received" } });
    const shared = await mount({ refusal: { code: "series.no_rectificative_for_node" } });

    expect(actions(own).error).toBe(
      "Esta cuenta tiene un pago, así que no se puede cancelar ni abonar.",
    );
    expect(actions(shared).error).toBe(
      "Este local no tiene una serie de facturas rectificativas. Avisa a un responsable",
    );
  });

  it.each([
    { code: "working_order.reason_required" },
    { code: "management.request_invalid", field: "reason" },
  ])(
    "puts a refusal of the reason ($code) beside the reason, until it is changed",
    async (refusal) => {
      const el = await mount({ refusal });

      expect(reason(el)!.error).toBe(t("cancel_credit.reason_invalid"));
      expect(actions(el).error).toBe(t("form.fix_fields"));
      await type(el, "Wrong table");
      expect(reason(el)!.error).toBe("");
      expect(actions(el).error).toBe("");
    },
  );

  it("while a request is out, holds the action and cannot be dismissed", async () => {
    const el = await mount({ busy: true });

    expect(confirm(el).loading).toBe(true);
    expect(confirm(el).disabled).toBe(true);
    expect(
      root(el).querySelector<HTMLElement & { dismissible: boolean }>("wt-dialog")!.dismissible,
    ).toBe(false);
    expect(
      root(el).querySelector<HTMLElement & { disabled: boolean }>("[data-cancel-credit-close]")!
        .disabled,
    ).toBe(true);
  });

  it("Cancel asks to close", async () => {
    const el = await mount();
    const closed = capture(el, "cancel-credit-close");

    root(el).querySelector<HTMLElement>("[data-cancel-credit-close]")!.click();

    expect(closed).toHaveLength(1);
  });
});

describe("till-cancel-credit-dialog: dismissing", () => {
  it("asks to close when the dialog itself is dismissed", async () => {
    const el = await mount();
    const closed = capture(el, "cancel-credit-close");

    root(el).querySelector("wt-dialog")!.dispatchEvent(new CustomEvent("wt-close"));

    expect(closed).toHaveLength(1);
  });
});

describe("till-cancel-credit-dialog: done", () => {
  it("names the credit note issued, offers only Done, and asks for no reason", async () => {
    const el = await mount({ done: { creditNote: "R/3" } });
    const closed = capture(el, "cancel-credit-close");

    expect(text(root(el).querySelector("[data-cancel-credit-done]"))).toBe(
      "Credit note R/3 issued. The bill is cancelled.",
    );
    expect(reason(el)).toBeNull();
    expect(root(el).querySelector("[data-cancel-credit-confirm]")).toBeNull();
    root(el).querySelector<HTMLElement>("[data-cancel-credit-finished]")!.click();
    expect(closed).toHaveLength(1);
  });

  it("puts Done in the shared actions row", async () => {
    const el = await mount({ done: { creditNote: "R/3" } });

    expect(root(el).querySelector("wt-form-actions [data-cancel-credit-finished]")).not.toBeNull();
  });

  it("says the bill is cancelled when the credit note's number could not be read", async () => {
    const el = await mount({ done: { creditNote: null } });

    expect(text(root(el).querySelector("[data-cancel-credit-done]"))).toBe(
      t("cancel_credit.done_unnumbered"),
    );
  });

  it("speaks Spanish", async () => {
    setLocale("es");
    const el = await mount({ done: { creditNote: "R/3" } });

    expect(text(root(el).querySelector("[data-cancel-credit-done]"))).toBe(
      "Factura rectificativa R/3 emitida. La cuenta queda cancelada.",
    );
  });
});

it.each(["en-GB", "es"])(
  "an invoice cancellation clock refusal describes the refused operation in %s",
  async (locale) => {
    setLocale(locale);
    const el = await mount({ refusal: { code: "clock.unusable" } });
    expect(actions(el).error).toBe(
      locale === "en-GB"
        ? "Can't be recorded: the server's clock is wrong. It can be set in the dashboard, under Box status."
        : codeMessage("clock.unusable", locale),
    );
  },
);

describe("till-cancel-credit-dialog: Reopen to split", () => {
  const served = { lineId: "l-1", dishName: "Steak", quantity: "1", released: true };
  const two = { lineId: "l-2", dishName: "Caña", quantity: "2", released: true };
  const held = { lineId: "l-3", dishName: "Tarta", quantity: "1", released: false };
  const unservedBox = (el: TillCancelCreditDialog) =>
    root(el).querySelector("[data-split-unserved]");
  const markServed = (el: TillCancelCreditDialog) =>
    root(el).querySelector<HTMLElement>("[data-split-mark-served]");

  it("says the receipt is credited and its dishes go onto a new bill, and asks for no reason", async () => {
    const el = await mount({ mode: "split" });

    expect(text(root(el).querySelector("[data-cancel-credit-scope]"))).toBe(
      `Receipt A/12 (${money("24.50")}) is credited in full with a credit note, and its dishes go onto a new open bill so each guest can have their own receipt.`,
    );
    expect(reason(el)).toBeNull();
    expect(text(confirm(el))).toBe("Reopen to split");
    expect(text(root(el).querySelector("[data-cancel-credit-close]"))).toBe("Keep the bill");
    expect(root(el).querySelector<HTMLElement & { heading: string }>("wt-dialog")!.heading).toBe(
      "Reopen to split",
    );
    expect(confirm(el).disabled).toBe(false);
  });

  it("says the same of a receipt whose number it was not given", async () => {
    const el = await mount({ mode: "split", invoiceNumber: null });

    expect(text(root(el).querySelector("[data-cancel-credit-scope]"))).toBe(
      `This bill's receipt (${money("24.50")}) is credited in full with a credit note, and its dishes go onto a new open bill so each guest can have their own receipt.`,
    );
  });

  it("continues at once, and closes with nothing to keep", async () => {
    const el = await mount({ mode: "split" });
    const continued = capture(el, "cancel-credit-continue");
    const closed = capture(el, "cancel-credit-close");

    await press(el);
    root(el).querySelector<HTMLElement>("[data-cancel-credit-close]")!.click();

    expect(continued).toEqual([{ reason: "" }]);
    expect(closed).toHaveLength(1);
  });

  it("lists the dishes not marked served, and Mark served asks to serve those the kitchen has", async () => {
    const el = await mount({
      mode: "split",
      refusal: { code: "bill.unserved_dishes", dishes: [served, two] },
      canMarkServed: true,
    });
    const asked = capture(el, "split-mark-served");

    expect(text(unservedBox(el))).toContain(
      "Some dishes on this bill are not marked served, so it cannot be split yet. If the guests have had them, choose Mark served: the receipt is then credited and the dishes go onto a new bill.",
    );
    expect([...root(el).querySelectorAll("[data-unserved-dish]")].map(text)).toEqual([
      "Steak",
      "2 × Caña",
    ]);
    expect(actions(el).error).toBe("");
    markServed(el)!.click();
    expect(asked).toEqual([
      {
        items: [
          { lineId: "l-1", quantity: "1" },
          { lineId: "l-2", quantity: "2" },
        ],
      },
    ]);
  });

  it("marks a held dish, tells staff to fire its group first, and offers Mark served only for the others", async () => {
    const el = await mount({
      mode: "split",
      refusal: { code: "bill.unserved_dishes", dishes: [served, held] },
      canMarkServed: true,
    });
    const asked = capture(el, "split-mark-served");

    expect(text(unservedBox(el))).toContain(
      "Some dishes on this bill are not marked served, so it cannot be split yet. Choose Fire on each held group first, then mark its dishes served and choose Reopen to split again.",
    );
    expect([...root(el).querySelectorAll("[data-unserved-dish]")].map(text)).toEqual([
      "Steak",
      "Tarta — held: choose Fire on its group first",
    ]);
    markServed(el)!.click();
    expect(asked).toEqual([{ items: [{ lineId: "l-1", quantity: "1" }] }]);
  });

  it("offers no Mark served when every dish is held", async () => {
    const el = await mount({
      mode: "split",
      refusal: { code: "bill.unserved_dishes", dishes: [held] },
      canMarkServed: true,
    });

    expect(text(unservedBox(el))).toContain(t("split.unserved_held"));
    expect(markServed(el)).toBeNull();
  });

  it("on a device that cannot mark dishes served, says so and what to do, with no Mark served", async () => {
    const el = await mount({
      mode: "split",
      refusal: { code: "bill.unserved_dishes", dishes: [served, held] },
      canMarkServed: false,
    });

    expect(text(unservedBox(el))).toContain(
      "Some dishes on this bill are not marked served, so it cannot be split yet. This device cannot mark dishes served: mark them served on a device that can, then choose Reopen to split again.",
    );
    expect(text(unservedBox(el))).not.toContain(t("split.unserved_held"));
    expect([...root(el).querySelectorAll("[data-unserved-dish]")].map(text)).toEqual([
      "Steak",
      "Tarta — held: choose Fire on its group first",
    ]);
    expect(markServed(el)).toBeNull();
  });

  it.each(["sale.correction_unsupported", "working_order.not_placed"])(
    "says %s in its own sentence above the action",
    async (code) => {
      const el = await mount({ mode: "split", refusal: { code } });

      expect(actions(el).error).toBe(codeMessage(code));
      expect(actions(el).error).not.toBe(codeMessage("some.unmapped_code"));
      expect(unservedBox(el)).toBeNull();
    },
  );

  it("says the dishes are not served even when the refusal lists none", async () => {
    const el = await mount({ mode: "split", refusal: { code: "bill.unserved_dishes" } });

    expect(actions(el).error).toBe(t("split.unserved"));
    expect(unservedBox(el)).toBeNull();
  });

  it.each([
    [
      "bill.payments_received",
      "Part of this bill is paid, so it cannot be split this way. The other guests pay the rest of this receipt with Pay.",
    ],
    [
      "bill.left_unpaid",
      "This bill was recorded as left unpaid, so its guests have gone and there is nothing to split.",
    ],
    ["bill.not_at_table", "Only a table's bill can be split this way. Nothing was credited."],
    ["bill.not_issued", "This bill has no receipt yet, so nothing was credited."],
    [
      "order.payment_in_flight",
      "A card payment on this bill is pending. Wait for the reader, then choose Pay to check it. If it was not taken, choose Reopen to split again.",
    ],
    [
      "network",
      "Reopen to split got no answer, so it may have been made. Check the table's bills before trying again.",
    ],
  ])("words %s for a split, not for a cancel", async (code, sentence) => {
    const el = await mount({ mode: "split", refusal: { code } });

    expect(actions(el).error).toBe(sentence);
  });

  it("keeps the approver refusal, which is the same for a split", async () => {
    const el = await mount({ mode: "split", refusal: { code: "authorization.not_permitted" } });

    expect(actions(el).error).toBe(t("cancel_credit.refused_not_permitted"));
  });

  it("names the credit note and says what to do next", async () => {
    const el = await mount({ mode: "split", done: { creditNote: "R/3" } });

    expect(text(root(el).querySelector("[data-cancel-credit-done]"))).toBe(
      "Credit note R/3 issued. Move each guest's dishes to their own bill, then print each one.",
    );
  });

  it("says a bill found already credited opened no new bill", async () => {
    const el = await mount({ mode: "split", done: { creditNote: "R/3", creditedElsewhere: true } });

    expect(text(root(el).querySelector("[data-cancel-credit-done]"))).toBe(
      "Credit note R/3 was already issued for this bill, perhaps on another device, and no new bill was opened. Nothing more was credited.",
    );

    el.done = { creditNote: null, creditedElsewhere: true };
    await el.updateComplete;
    expect(text(root(el).querySelector("[data-cancel-credit-done]"))).toBe(
      "This bill was already credited, perhaps on another device, and no new bill was opened. Nothing more was credited.",
    );
  });

  it("speaks Spanish", async () => {
    setLocale("es");
    const el = await mount({
      mode: "split",
      refusal: { code: "bill.unserved_dishes", dishes: [served] },
      canMarkServed: true,
    });

    expect(text(unservedBox(el))).toContain(
      "Algunos platos de esta cuenta no están marcados como servidos, así que aún no se puede dividir. Si los clientes ya los han tomado, pulsa Marcar como servidos: después el ticket se abona y los platos pasan a una cuenta nueva.",
    );
    expect(text(confirm(el))).toBe(t("split.confirm"));
    expect(t("split.confirm")).not.toBe("Reopen to split");
  });

  it("speaks Spanish for a held dish, a device that cannot mark served, a part-paid bill and a bill already credited", async () => {
    setLocale("es");
    const el = await mount({
      mode: "split",
      refusal: { code: "bill.unserved_dishes", dishes: [served, held] },
      canMarkServed: true,
    });

    expect(text(unservedBox(el))).toContain(
      "Algunos platos de esta cuenta no están marcados como servidos, así que aún no se puede dividir. Pulsa antes Marchar en cada grupo en espera, marca sus platos como servidos y vuelve a elegir Reabrir para dividir.",
    );
    expect([...root(el).querySelectorAll("[data-unserved-dish]")].map(text)).toEqual([
      "Steak",
      "Tarta — en espera: pulsa antes Marchar en su grupo",
    ]);

    el.canMarkServed = false;
    await el.updateComplete;
    expect(text(unservedBox(el))).toContain(
      "Algunos platos de esta cuenta no están marcados como servidos, así que aún no se puede dividir. Este dispositivo no puede marcar platos como servidos: márcalos en un dispositivo que pueda y vuelve a elegir Reabrir para dividir.",
    );

    el.refusal = { code: "bill.payments_received" };
    await el.updateComplete;
    expect(actions(el).error).toBe(
      "Parte de esta cuenta ya está pagada, así que no se puede dividir así. Los demás clientes pagan el resto de este ticket con Cobrar.",
    );

    el.done = { creditNote: "R/3", creditedElsewhere: true };
    await el.updateComplete;
    expect(text(root(el).querySelector("[data-cancel-credit-done]"))).toBe(
      "Ya se había emitido la factura rectificativa R/3 para esta cuenta, quizá en otro dispositivo, y no se abrió ninguna cuenta nueva. No se ha abonado nada más.",
    );
  });
});
