import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { formatMoney } from "@waitron/shared";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { currentLocale, setLocale, t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
import {
  refusalField,
  type AdjustmentChoice,
  type AdjustTarget,
  type TillAdjustmentDialog,
} from "./adjustment-dialog.js";
import type { AdjustmentPreview, AdjustmentReason } from "../api/client.js";

afterEach(cleanupWidgets);
beforeEach(() => setLocale("en"));

function reason(id: string, over: Partial<AdjustmentReason> = {}): AdjustmentReason {
  return {
    id,
    name: id,
    actions: ["comp"],
    noteRequired: false,
    maxPercentBp: null,
    maxAmount: null,
    applyRole: "staff",
    approverRole: "manager",
    ...over,
  };
}

const complaint = reason("Complaint", { actions: ["comp", "discount_percent"] });
const mistake = reason("Mistake", { actions: ["cancel"], noteRequired: true });
const regular = reason("Regular", { actions: ["discount_percent", "discount_amount"] });
const staffMeal = reason("Staff meal", { actions: ["comp", "discount_amount"] });
const allReasons = [complaint, mistake, regular, staffMeal];

const burger: AdjustTarget = {
  lineId: "line-1",
  name: "Burger",
  quantity: "1",
  total: "12.00",
  unitTotal: null,
};
const steaks: AdjustTarget = {
  lineId: "line-2",
  name: "Steak",
  quantity: "2",
  total: "50.00",
  unitTotal: "25.00",
};

async function mount(over: Partial<TillAdjustmentDialog> = {}) {
  const { el } = await mountWidget<TillAdjustmentDialog>("till-adjustment-dialog", {
    kind: "comp",
    target: burger,
    reasons: allReasons,
    ...over,
  });
  return el;
}

const root = (el: TillAdjustmentDialog) => el.shadowRoot!;
const text = (el: Element | ShadowRoot) => (el.textContent ?? "").replace(/[ \t\n]+/g, " ").trim();
const reasonNames = (el: TillAdjustmentDialog) =>
  [...root(el).querySelectorAll<HTMLInputElement>('input[name="reason"]')].map((radio) =>
    radio.closest("label")!.textContent!.trim(),
  );
const continueButton = (el: TillAdjustmentDialog) =>
  root(el).querySelector<HTMLElement & { disabled: boolean }>("[data-adjust-continue]")!;
const confirmButton = (el: TillAdjustmentDialog) =>
  root(el).querySelector<HTMLElement & { disabled: boolean }>("[data-adjust-confirm]")!;
const actions = (el: TillAdjustmentDialog) =>
  root(el).querySelector<HTMLElement & { error: string }>("wt-form-actions")!;
const field = (el: TillAdjustmentDialog, name: string) =>
  root(el).querySelector<HTMLElement & { error: string; required: boolean }>(
    `wt-input[name="${name}"]`,
  )!;
const fieldsetError = (el: TillAdjustmentDialog, which: string) =>
  root(el).querySelector(`[data-error-for="${which}"]`)?.textContent?.trim() ?? "";

/** Every message the form shows: under each field, and above the action. */
const shownMessages = (el: TillAdjustmentDialog) => [
  ...[...root(el).querySelectorAll<HTMLElement & { error: string }>("wt-input")].map(
    (input) => input.error,
  ),
  ...[...root(el).querySelectorAll("[data-error-for]")].map((error) => error.textContent!.trim()),
  actions(el).error,
];

async function chooseReason(el: TillAdjustmentDialog, name: string): Promise<void> {
  const radio = [...root(el).querySelectorAll<HTMLInputElement>('input[name="reason"]')].find(
    (candidate) => candidate.closest("label")!.textContent!.trim() === name,
  )!;
  radio.click();
  await el.updateComplete;
}

async function choose(el: TillAdjustmentDialog, name: string, value: string): Promise<void> {
  root(el).querySelector<HTMLInputElement>(`input[name="${name}"][value="${value}"]`)!.click();
  await el.updateComplete;
}

async function type(el: TillAdjustmentDialog, name: string, value: string): Promise<void> {
  const input = field(el, name).shadowRoot!.querySelector("input")!;
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  await el.updateComplete;
}

function capture<T>(el: TillAdjustmentDialog, type: string): T[] {
  const seen: T[] = [];
  el.addEventListener(type, (event) => seen.push((event as CustomEvent<T>).detail));
  return seen;
}

async function press(button: HTMLElement, el: TillAdjustmentDialog): Promise<void> {
  button.click();
  await el.updateComplete;
}

const money = (amount: string) => formatMoney(amount, currentLocale());

describe("till-adjustment-dialog: the reasons it offers", () => {
  it("lists only the reasons that allow a give-away", async () => {
    const el = await mount({ kind: "comp" });
    expect(reasonNames(el)).toEqual(["Complaint", "Staff meal"]);
  });

  it("lists only the reasons that allow a cancel", async () => {
    const el = await mount({ kind: "cancel" });
    expect(reasonNames(el)).toEqual(["Mistake"]);
  });

  it("lists the reasons for the kind of discount chosen", async () => {
    const el = await mount({ kind: "discount" });
    expect(reasonNames(el)).toEqual(["Complaint", "Regular"]);
    await chooseReason(el, "Complaint");

    await choose(el, "discountKind", "amount");

    expect(reasonNames(el)).toEqual(["Regular", "Staff meal"]);
    // The reason chosen does not allow an amount, so nothing stays chosen.
    expect(
      [...root(el).querySelectorAll<HTMLInputElement>('input[name="reason"]')].some(
        (radio) => radio.checked,
      ),
    ).toBe(false);
  });

  it("offers only the kinds of discount some reason allows", async () => {
    const el = await mount({ kind: "discount", reasons: [staffMeal] });
    expect(root(el).querySelector('input[name="discountKind"]')).toBeNull();
    expect(field(el, "amount")).not.toBeNull();
    expect(root(el).querySelector('wt-input[name="percent"]')).toBeNull();
  });

  it("says a manager must add a reason in the dashboard when none allows the action, and offers only Close", async () => {
    const el = await mount({ kind: "cancel", reasons: [complaint] });
    expect(text(root(el))).toContain(t("adjust.no_reasons"));
    expect(root(el).querySelector("[data-adjust-continue]")).toBeNull();
    const closed = capture(el, "adjust-close");
    await press(root(el).querySelector<HTMLElement>("[data-adjust-close]")!, el);
    expect(closed).toHaveLength(1);
  });

  it("says so for a discount when no reason allows either kind", async () => {
    const el = await mount({ kind: "discount", reasons: [mistake] });
    expect(text(root(el))).toContain(t("adjust.no_reasons"));
  });
});

describe("till-adjustment-dialog: the form", () => {
  it("shows what it acts on before anything is done", async () => {
    const el = await mount({ kind: "comp", target: steaks });
    expect(text(root(el).querySelector("[data-adjust-scope]")!)).toBe(
      `Steak ×2 · ${money("50.00")}`,
    );
  });

  it("tells staff, above the action, to discount the whole of a weighed line rather than part", async () => {
    const ham: AdjustTarget = {
      lineId: "line-4",
      name: "Ham",
      quantity: "0.333",
      total: "7.99",
      unitTotal: null,
      weighed: true,
    };
    const hint = (el: TillAdjustmentDialog) =>
      root(el).querySelector("[data-weighed-hint]")?.textContent?.trim() ?? null;
    for (const kind of ["comp", "discount"] as const) {
      const el = await mount({ kind, target: ham });
      expect(hint(el), kind).toBe(codeMessage("adjustment.weighed_partial"));
      expect(root(el).querySelector("[data-quantity]"), kind).toBeNull();
      // Above the action: the last thing before the row holding it.
      expect(root(el).querySelector("[data-weighed-hint]")!.nextElementSibling!.tagName).toBe(
        "WT-FORM-ACTIONS",
      );
    }
    expect(hint(await mount({ kind: "cancel", target: ham }))).toBeNull();
    expect(hint(await mount({ kind: "discount", target: burger }))).toBeNull();

    setLocale("es-ES");
    expect(hint(await mount({ kind: "discount", target: ham }))).toBe(
      "Parte de un artículo que se vende al peso o por medida no se puede invitar ni descontar. Haz un descuento sobre la línea entera",
    );
  });

  it("titles an extra's dialogs with an extra, and a dish's with an item, in both languages", async () => {
    const olives: AdjustTarget = { ...burger, name: "Olives (with Pizza)", extra: true };
    const heading = async (kind: TillAdjustmentDialog["kind"], target: AdjustTarget) =>
      root(await mount({ kind, target })).querySelector<HTMLElement & { heading: string }>(
        "wt-dialog",
      )!.heading;

    expect(await heading("comp", olives)).toBe("Give an extra away");
    expect(await heading("discount", olives)).toBe("Discount an extra");
    expect(await heading("cancel", olives)).toBe("Cancel an extra");
    expect(await heading("comp", burger)).toBe("Give an item away");
    expect(await heading("discount", burger)).toBe("Discount an item");
    expect(await heading("cancel", burger)).toBe("Cancel an item");

    setLocale("es-ES");
    expect(await heading("comp", olives)).toBe("Invitar un extra");
    expect(await heading("discount", olives)).toBe("Descuento en un extra");
    expect(await heading("cancel", olives)).toBe("Cancelar un extra");
  });

  // Fails if cancelling an extra of a dish the kitchen has does not say the kitchen is told, or if
  // any other cancel starts saying so.
  it("says the kitchen is told when an extra of a fired dish is cancelled, and only then", async () => {
    const olives: AdjustTarget = { ...burger, name: "Olives (with Pizza)", extra: true };
    const lead = async (target: AdjustTarget) =>
      text(root(await mount({ kind: "cancel", target })).querySelector("p.lead")!);

    expect(await lead({ ...olives, kitchenTold: true })).toBe(
      "It comes off the bill, and the kitchen is told.",
    );
    expect(await lead(olives)).toBe(t("table.cancel_sent"));
    expect(await lead(burger)).toBe(t("table.cancel_sent"));
    expect(t("table.cancel_sent")).toBe("It comes off the bill.");

    setLocale("es-ES");
    expect(await lead({ ...olives, kitchenTold: true })).toBe(
      "Se quitará de la cuenta y se avisará a cocina.",
    );
    expect(await lead(olives)).toBe("Se quitará de la cuenta.");
  });

  it("names the whole bill for a bill discount", async () => {
    const el = await mount({
      kind: "discount",
      target: {
        lineId: null,
        name: t("adjust.whole_bill"),
        quantity: null,
        total: "42.48",
        unitTotal: null,
      },
    });
    expect(text(root(el).querySelector("[data-adjust-scope]")!)).toBe(
      `${t("adjust.whole_bill")} · ${money("42.48")}`,
    );
  });

  it("marks the reason and the value required, and explains an empty submission beside each field and above the action", async () => {
    const el = await mount({ kind: "discount" });
    const asked = capture<AdjustmentChoice>(el, "adjust-preview");
    expect(root(el).querySelector("[data-reason-required]")).not.toBeNull();
    expect(field(el, "percent").required).toBe(true);
    expect(continueButton(el).disabled).toBe(false);

    await press(continueButton(el), el);

    expect(asked).toEqual([]);
    expect(fieldsetError(el, "reason")).toBe(t("adjust.reason_required"));
    expect(field(el, "percent").error).toBe(t("adjust.percent_invalid"));
    expect(actions(el).error).toBe(t("form.fix_fields"));
    expect(continueButton(el).disabled).toBe(true);

    await chooseReason(el, "Regular");
    expect(fieldsetError(el, "reason")).toBe("");
    expect(continueButton(el).disabled).toBe(true);
    await type(el, "percent", "12,5");
    expect(field(el, "percent").error).toBe("");
    expect(actions(el).error).toBe("");
    expect(continueButton(el).disabled).toBe(false);

    await press(continueButton(el), el);
    expect(asked).toEqual([
      { action: "discount_percent", reasonId: "Regular", note: null, percentBp: 1250 },
    ]);
  });

  it("enforces a note beside the note field when the chosen reason needs one", async () => {
    const el = await mount({ kind: "cancel" });
    const asked = capture<AdjustmentChoice>(el, "adjust-preview");
    expect(field(el, "note").required).toBe(false);
    await chooseReason(el, "Mistake");
    expect(field(el, "note").required).toBe(true);

    await press(continueButton(el), el);
    expect(field(el, "note").error).toBe(t("adjust.note_required"));
    expect(actions(el).error).toBe(t("form.fix_fields"));
    expect(asked).toEqual([]);

    await type(el, "note", "  wrong table  ");
    expect(field(el, "note").error).toBe("");
    await press(continueButton(el), el);
    expect(asked).toEqual([{ action: "cancel", reasonId: "Mistake", note: "wrong table" }]);
  });

  it("refuses a percentage above 100 and an amount above what it applies to", async () => {
    const el = await mount({ kind: "discount", target: steaks });
    await chooseReason(el, "Regular");
    await type(el, "percent", "101");
    await press(continueButton(el), el);
    expect(field(el, "percent").error).toBe(t("adjust.percent_invalid"));

    await choose(el, "discountKind", "amount");
    await chooseReason(el, "Regular");
    await type(el, "amount", "50.01");
    expect(field(el, "amount").error).toBe(
      t("adjust.amount_too_large").replace("{total}", money("50.00")),
    );
    await type(el, "amount", "2.555");
    expect(field(el, "amount").error).toBe(t("adjust.amount_invalid"));
    // One of the two: no more than one steak's price.
    await choose(el, "quantity", "1");
    await type(el, "amount", "25.01");
    expect(field(el, "amount").error).toBe(
      t("adjust.amount_too_large").replace("{total}", money("25.00")),
    );
  });

  it("sends an amount with a point, whichever separator was typed", async () => {
    const el = await mount({ kind: "discount", reasons: [staffMeal] });
    const asked = capture<AdjustmentChoice>(el, "adjust-preview");
    await chooseReason(el, "Staff meal");
    await type(el, "amount", "2,5");
    await press(continueButton(el), el);
    expect(asked).toEqual([
      { action: "discount_amount", reasonId: "Staff meal", note: null, amount: "2.5" },
    ]);
  });

  it("offers one or all of a line of several whole units, and sends one when chosen", async () => {
    const el = await mount({ kind: "comp", target: steaks });
    const asked = capture<AdjustmentChoice>(el, "adjust-preview");
    const labels = [...root(el).querySelectorAll('input[name="quantity"]')].map((radio) =>
      radio.closest("label")!.textContent!.trim(),
    );
    expect(labels).toEqual([
      t("adjust.quantity_one"),
      t("adjust.quantity_all").replace("{n}", "2"),
    ]);
    await chooseReason(el, "Complaint");
    await press(continueButton(el), el);
    await choose(el, "quantity", "1");
    await press(continueButton(el), el);
    expect(asked).toEqual([
      { action: "comp", reasonId: "Complaint", note: null },
      { action: "comp", reasonId: "Complaint", note: null, quantity: "1" },
    ]);
  });

  it("goes back to all of the dish when All is chosen again", async () => {
    const el = await mount({ kind: "comp", target: steaks });
    const asked = capture<AdjustmentChoice>(el, "adjust-preview");
    await chooseReason(el, "Complaint");
    await choose(el, "quantity", "1");
    await choose(el, "quantity", "all");
    await press(continueButton(el), el);
    expect(asked).toEqual([{ action: "comp", reasonId: "Complaint", note: null }]);
  });

  it("continues on Enter in the note and in the amount", async () => {
    const el = await mount({ kind: "discount", reasons: [staffMeal] });
    const asked = capture<AdjustmentChoice>(el, "adjust-preview");
    await chooseReason(el, "Staff meal");
    for (const name of ["amount", "note"]) {
      await type(el, name, name === "amount" ? "2" : "Regular");
      field(el, name)
        .shadowRoot!.querySelector("input")!
        .dispatchEvent(
          new KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true }),
        );
      await el.updateComplete;
    }
    expect(asked).toEqual([
      { action: "discount_amount", reasonId: "Staff meal", note: null, amount: "2" },
      { action: "discount_amount", reasonId: "Staff meal", note: "Regular", amount: "2" },
    ]);
  });

  it("draws nothing until it is given what it acts on", async () => {
    const el = await mount({ target: null });
    expect(root(el).querySelector("wt-dialog")).toBeNull();
  });

  it("asks no quantity of a line that can only be done whole", async () => {
    const el = await mount({ kind: "comp", target: burger });
    expect(root(el).querySelector('input[name="quantity"]')).toBeNull();
  });

  it("closes on Close and on Escape", async () => {
    const el = await mount();
    const closed = capture(el, "adjust-close");
    await press(root(el).querySelector<HTMLElement>("[data-adjust-close]")!, el);
    root(el).querySelector("wt-dialog")!.dispatchEvent(new CustomEvent("wt-close"));
    expect(closed).toHaveLength(2);
  });

  it("holds its actions, and cannot be closed, while a request is out", async () => {
    const el = await mount({ busy: true });
    expect(continueButton(el).disabled).toBe(true);
    expect(
      root(el).querySelector<HTMLElement & { disabled: boolean }>("[data-adjust-close]")!.disabled,
    ).toBe(true);
    expect(
      root(el).querySelector<HTMLElement & { dismissible: boolean }>("wt-dialog")!.dismissible,
    ).toBe(false);
    el.busy = false;
    await el.updateComplete;
    expect(
      root(el).querySelector<HTMLElement & { dismissible: boolean }>("wt-dialog")!.dismissible,
    ).toBe(true);
  });
});

describe("till-adjustment-dialog: what a request out holds still", () => {
  it("holds every field while a request is out", async () => {
    const el = await mount({ kind: "discount", target: steaks, busy: true });
    const fieldsets = [...root(el).querySelectorAll<HTMLFieldSetElement>("fieldset")];
    expect(fieldsets.length).toBeGreaterThan(0);
    expect(fieldsets.every((fieldset) => fieldset.disabled)).toBe(true);
    for (const name of ["percent", "note"])
      expect((field(el, name) as unknown as { disabled: boolean }).disabled).toBe(true);
  });

  it("confirms the choice it was previewed with, whatever the form now holds", async () => {
    const el = await mount({ kind: "comp", target: steaks });
    await chooseReason(el, "Complaint");
    const previewed: AdjustmentChoice = {
      action: "comp",
      reasonId: "Staff meal",
      note: "cold",
      quantity: "1",
    };
    el.choice = previewed;
    el.preview = {
      reduction: "25.00",
      nominalValue: "25.00",
      needsApproval: null,
      overBillDiscountLimit: false,
      lines: [],
    };
    await el.updateComplete;
    const confirmed = capture<AdjustmentChoice>(el, "adjust-confirm");

    expect(root(el).querySelector("[data-quantity-shown]")).not.toBeNull();
    expect(text(root(el))).toContain(t("adjust.reason_shown").replace("{reason}", "Staff meal"));
    expect(text(root(el))).toContain(t("adjust.note_shown").replace("{note}", "cold"));
    await press(confirmButton(el), el);
    expect(confirmed).toEqual([previewed]);
  });
});

describe("till-adjustment-dialog: before confirming", () => {
  const preview = (over: Partial<AdjustmentPreview> = {}): AdjustmentPreview => ({
    reduction: "12.00",
    nominalValue: "12.00",
    needsApproval: null,
    overBillDiscountLimit: false,
    lines: [],
    ...over,
  });

  async function atConfirm(
    over: Partial<TillAdjustmentDialog>,
    fill: (el: TillAdjustmentDialog) => Promise<void>,
  ) {
    const { preview: answer, ...rest } = over;
    const el = await mount(rest);
    const asked = capture<AdjustmentChoice>(el, "adjust-preview");
    await fill(el);
    await press(continueButton(el), el);
    expect(asked).toHaveLength(1);
    el.choice = asked[0]!;
    el.preview = answer ?? preview();
    await el.updateComplete;
    return { el, asked };
  }

  it("shows what the bill actually loses, and confirms the choice it previewed", async () => {
    const { el, asked } = await atConfirm({}, (el) => chooseReason(el, "Complaint"));
    const confirmed = capture<AdjustmentChoice>(el, "adjust-confirm");
    expect(text(root(el).querySelector("[data-takes-off]")!)).toBe(
      t("adjust.takes_off").replace("{amount}", money("12.00")),
    );
    expect(text(root(el))).toContain(t("adjust.reason_shown").replace("{reason}", "Complaint"));
    expect(text(root(el).querySelector("[data-adjust-scope]")!)).toBe(
      `Burger ×1 · ${money("12.00")}`,
    );
    expect(confirmButton(el).textContent!.trim()).toBe(t("adjust.do_comp"));

    await press(confirmButton(el), el);
    expect(confirmed).toEqual(asked);
  });

  it("restates that it acts on one of several units", async () => {
    const { el } = await atConfirm({ kind: "comp", target: steaks }, async (el) => {
      await chooseReason(el, "Complaint");
      await choose(el, "quantity", "1");
    });
    expect(text(root(el).querySelector("[data-quantity-shown]")!)).toBe(
      t("adjust.quantity_shown").replace("{n}", "2"),
    );
  });

  it("says nothing of a quantity when it acts on all of the dish", async () => {
    const { el } = await atConfirm({ kind: "comp", target: steaks }, (el) =>
      chooseReason(el, "Complaint"),
    );
    expect(root(el).querySelector("[data-quantity-shown]")).toBeNull();
  });

  it("asks for approval when the preview says a manager must approve", async () => {
    const { el } = await atConfirm({ preview: preview({ needsApproval: "manager" }) }, (el) =>
      chooseReason(el, "Complaint"),
    );
    expect(text(root(el))).toContain(t("adjust.approval_manager"));
    expect(confirmButton(el).textContent!.trim()).toBe(t("adjust.ask_approval"));
  });

  it("says the bill's discounts end past the venue's limit, beside the approval", async () => {
    const { el } = await atConfirm(
      {
        kind: "discount",
        reasons: [regular],
        preview: preview({ needsApproval: "manager", overBillDiscountLimit: true }),
      },
      async (el) => {
        await chooseReason(el, "Regular");
        await type(el, "percent", "30");
      },
    );
    const approval = root(el).querySelector("[data-needs-approval]")!;
    const why = root(el).querySelector("[data-over-bill-limit]")!;
    expect(text(why)).toBe(t("adjust.over_bill_limit"));
    expect(approval.nextElementSibling).toBe(why);
    expect(confirmButton(el).textContent!.trim()).toBe(t("adjust.ask_approval"));
  });

  it("says nothing of the limit when the preview does not flag it", async () => {
    const { el } = await atConfirm({ preview: preview({ needsApproval: "manager" }) }, (el) =>
      chooseReason(el, "Complaint"),
    );
    expect(root(el).querySelector("[data-needs-approval]")).not.toBeNull();
    expect(root(el).querySelector("[data-over-bill-limit]")).toBeNull();
    expect(text(root(el))).not.toContain(t("adjust.over_bill_limit"));
  });

  it("says a cancel leaves the bill's discounts past the venue's limit, beside the approval", async () => {
    const { el } = await atConfirm(
      {
        kind: "cancel",
        reasons: [reason("Void", { actions: ["cancel"] })],
        preview: preview({ needsApproval: "manager", overBillDiscountLimit: true }),
      },
      (el) => chooseReason(el, "Void"),
    );
    const approval = root(el).querySelector("[data-needs-approval]")!;
    const why = root(el).querySelector("[data-over-bill-limit]")!;
    expect(text(why)).toBe(t("adjust.over_bill_limit"));
    expect(approval.nextElementSibling).toBe(why);
    expect(confirmButton(el).textContent!.trim()).toBe(t("adjust.ask_approval"));
  });

  it("says when the prices allow a different amount than the one asked for", async () => {
    const { el } = await atConfirm(
      { kind: "discount", reasons: [staffMeal], preview: preview({ reduction: "3.28" }) },
      async (el) => {
        await chooseReason(el, "Staff meal");
        await type(el, "amount", "3.27");
      },
    );
    expect(text(root(el).querySelector("[data-takes-off]")!)).toBe(
      t("adjust.takes_off").replace("{amount}", money("3.28")),
    );
    expect(text(root(el))).toContain(
      t("adjust.nearest").replace("{amount}", money("3.28")).replace("{asked}", money("3.27")),
    );
    expect(confirmButton(el).textContent!.trim()).toBe(t("adjust.do_discount"));
  });

  it("names no reason once the reasons no longer hold the one chosen", async () => {
    const { el } = await atConfirm({}, (el) => chooseReason(el, "Complaint"));
    el.reasons = [staffMeal];
    await el.updateComplete;
    expect(text(root(el))).not.toContain(t("adjust.reason_shown").replace("{reason}", "Complaint"));
    expect(root(el).querySelector("[data-takes-off]")).not.toBeNull();
  });

  it("goes back to the form, keeping what was chosen", async () => {
    const { el } = await atConfirm({ kind: "cancel" }, async (el) => {
      await chooseReason(el, "Mistake");
      await type(el, "note", "wrong table");
    });
    expect(confirmButton(el).textContent!.trim()).toBe(t("adjust.do_cancel"));
    expect(text(root(el))).toContain(t("adjust.note_shown").replace("{note}", "wrong table"));
    const edits = capture(el, "adjust-edit");
    await press(root(el).querySelector<HTMLElement>("[data-adjust-back]")!, el);
    expect(edits).toHaveLength(1);
    el.preview = null;
    await el.updateComplete;
    expect(field(el, "note").shadowRoot!.querySelector("input")!.value).toBe("wrong table");
  });
});

describe("till-adjustment-dialog: a refusal from the server", () => {
  it("puts a refusal that names a shown field under that field, keeps the action working, and clears it once the field changes", async () => {
    const el = await mount({ kind: "cancel" });
    await chooseReason(el, "Mistake");
    await type(el, "note", "x");
    el.refusal = "adjustment.note_required";
    await el.updateComplete;

    expect(field(el, "note").error).toBe(codeMessage("adjustment.note_required"));
    expect(actions(el).error).toBe(t("form.fix_fields"));
    expect(continueButton(el).disabled).toBe(false);

    await type(el, "note", "wrong table");
    expect(field(el, "note").error).toBe("");
    expect(actions(el).error).toBe("");
  });

  it("puts a refusal that names no shown field above the action, and the action stays enabled", async () => {
    const el = await mount({ kind: "comp", refusal: "bill.line_paid" });
    expect(actions(el).error).toBe(codeMessage("bill.line_paid"));
    expect(continueButton(el).disabled).toBe(false);
  });

  it.each([
    "adjustment.action_not_allowed",
    "adjustment.over_limit",
    "adjustment.note_required",
    "adjustment.reason_inactive",
    "adjustment.exceeds_amount",
    "adjustment.approval_required",
    "adjustment.weighed_partial",
    "adjustment.quantity_invalid",
    "adjustment_reason.not_found",
    "bill.line_paid",
    "bill.received_exceeds_total",
    "bill.refund_in_progress",
    "order.payment_in_flight",
    "tab.not_open",
  ])("shows %s in its own words", async (code) => {
    const el = await mount({ kind: "discount", target: steaks, refusal: code });
    expect(codeMessage(code)).not.toBe(codeMessage("server.internal"));
    expect(shownMessages(el).join(" ")).toContain(codeMessage(code));
  });

  it("shows a refusal on the confirm step above the action", async () => {
    const el = await mount({ kind: "comp" });
    const asked = capture<AdjustmentChoice>(el, "adjust-preview");
    await chooseReason(el, "Complaint");
    await press(continueButton(el), el);
    el.choice = asked[0]!;
    el.preview = {
      reduction: "12.00",
      nominalValue: "12.00",
      needsApproval: null,
      overBillDiscountLimit: false,
      lines: [],
    };
    el.refusal = "order.payment_in_flight";
    await el.updateComplete;
    expect(actions(el).error).toBe(codeMessage("order.payment_in_flight"));
    expect(confirmButton(el).disabled).toBe(false);
  });

  it("names the field each refusal belongs to", () => {
    expect(refusalField("adjustment.note_required", "comp", false)).toBe("note");
    expect(refusalField("adjustment.exceeds_amount", "discount", false)).toBe("value");
    expect(refusalField("adjustment.over_limit", "discount", false)).toBe("value");
    expect(refusalField("adjustment.over_limit", "comp", false)).toBe("reason");
    expect(refusalField("adjustment.reason_inactive", "comp", false)).toBe("reason");
    expect(refusalField("adjustment.action_not_allowed", "comp", false)).toBe("reason");
    expect(refusalField("adjustment_reason.not_found", "comp", false)).toBe("reason");
    expect(refusalField("adjustment.weighed_partial", "discount", true)).toBe("quantity");
    expect(refusalField("adjustment.quantity_invalid", "comp", true)).toBe("quantity");
    expect(refusalField("adjustment.quantity_invalid", "comp", false)).toBeNull();
    expect(refusalField("adjustment.exceeds_amount", "comp", false)).toBeNull();
    expect(refusalField("adjustment.no_reduction", "discount", false)).toBe("value");
    expect(refusalField("adjustment.no_reduction", "comp", true)).toBeNull();
    expect(refusalField("bill.line_paid", "comp", false)).toBeNull();
  });
});

for (const locale of ["en", "es"]) {
  it(`decimal input in a till discount follows ${locale}`, async () => {
    setLocale(locale);
    const el = await mount({ kind: "discount", reasons: [staffMeal] });
    const asked = capture<AdjustmentChoice>(el, "adjust-preview");
    await chooseReason(el, "Staff meal");
    const control = field(el, "amount") as HTMLElement & { updateComplete: Promise<unknown> };
    await control.updateComplete;
    const native = control.shadowRoot!.querySelector("input")!;
    for (const separator of [".", ","]) {
      native.value = `2${separator}80`;
      native.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
      await el.updateComplete;
      await control.updateComplete;
      expect(native.value).toBe(locale === "es" ? "2,80" : "2.80");
    }
    await press(continueButton(el), el);
    expect(asked).toEqual([
      { action: "discount_amount", reasonId: "Staff meal", note: null, amount: "2.80" },
    ]);
  });
}
