import { afterEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { chooseOption } from "@waitron/ui/src/test-helpers.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import type { PurchaseForm } from "./purchase-form.js";
import "./purchase-form.js";
import type { PurchaseInvoice } from "../api/client.js";
import { setLocale, t } from "../i18n/t.js";

afterEach(() => {
  cleanupWidgets();
  setLocale("es-ES");
});

// Every field holds something other than its blank-form default, in the spelling the server lists
// it in, so a field that rewrites its value on first draw shows as a change.
const stored: PurchaseInvoice = {
  id: "pi-1",
  supplierTaxId: "B99999999",
  supplierName: "Proveedor Editado SL",
  supplierInvoiceNumber: "E-2026/007",
  issuedOn: "2026-07-01",
  receivedOn: "2026-07-03",
  total: "231.00",
  regime: "equivalence_surcharge",
  deductibleProportion: "50.00",
  note: "Con nota",
  lines: [
    { rate: "10.00", base: "100.00", tax: "10.00", kind: "capital" },
    { rate: "21.00", base: "100.00", tax: "21.00", kind: "ordinary" },
  ],
};

async function mount(
  invoice: PurchaseInvoice | null = stored,
  locale: "en-GB" | "es-ES" = "en-GB",
) {
  setLocale(locale);
  const { el } = await mountWidget<PurchaseForm>("dashboard-purchase-form", {
    open: true,
    invoice,
  });
  await el.shadowRoot!.querySelector("wt-dialog")!.updateComplete;
  const sent = vi.fn<(type: string, detail: unknown) => void>();
  for (const type of ["create-purchase", "update-purchase"])
    el.addEventListener(type, (event) => sent(type, (event as CustomEvent).detail));
  return { el, sent };
}

const q = <T extends HTMLElement = HTMLElement>(el: PurchaseForm, selector: string) =>
  el.shadowRoot!.querySelector<T>(selector);
const confirm = (el: PurchaseForm) =>
  q<HTMLElementTagNameMap["wt-button"]>(el, "[data-test=confirm]")!;

/** What the confirm button looks like and whether a person can press it: host and inner button. */
async function state(el: PurchaseForm) {
  await el.updateComplete;
  const action = confirm(el);
  await action.updateComplete;
  return {
    variant: action.variant,
    disabled: action.disabled,
    innerDisabled: action.shadowRoot!.querySelector("button")!.disabled,
  };
}
const quiet = { variant: "secondary", disabled: true, innerDisabled: true };
const ready = { variant: "primary", disabled: false, innerDisabled: false };
const blocked = { variant: "primary", disabled: true, innerDisabled: true };

/** A real pointer press on the confirm button's inner button; `force` presses a disabled one too. */
async function press(el: PurchaseForm) {
  await userEvent.click(page.elementLocator(confirm(el).shadowRoot!.querySelector("button")!), {
    force: true,
  });
  await el.updateComplete;
}
function inner(el: PurchaseForm, test: string) {
  return q<HTMLElement & { updateComplete: Promise<unknown> }>(
    el,
    `[data-test=${test}]`,
  )!.shadowRoot!.querySelector("input")!;
}
async function type(el: PurchaseForm, test: string, value: string) {
  await q<HTMLElement & { updateComplete: Promise<unknown> }>(el, `[data-test=${test}]`)!
    .updateComplete;
  await userEvent.fill(page.elementLocator(inner(el, test)), value);
  await el.updateComplete;
}
const errors = (el: PurchaseForm) =>
  [...el.shadowRoot!.querySelectorAll("[error]")]
    .map((field) => field.getAttribute("error"))
    .filter((error) => error !== "");

for (const [invoice, locale] of [
  [stored, "en-GB"],
  [stored, "es-ES"],
  [null, "en-GB"],
] as const) {
  it(`${invoice ? "an edit" : "a new invoice"} in ${locale} opens quiet, and neither a press, a host click nor Enter sends or marks anything`, async () => {
    const { el, sent } = await mount(invoice, locale);
    expect(await state(el)).toEqual(quiet);
    await press(el);
    confirm(el).click();
    await el.updateComplete;
    inner(el, "supplier-name").focus();
    await userEvent.keyboard("{Enter}");
    await el.updateComplete;
    expect(sent).not.toHaveBeenCalled();
    expect(errors(el)).toEqual([]);
    expect(el.open).toBe(true);
  });
}

it.each([
  ["supplier-tax-id", "B11111111", "B99999999"],
  ["supplier-name", "Otro SL", "Proveedor Editado SL"],
  ["supplier-invoice-number", "E-2026/008", "E-2026/007"],
  ["issued-on", "2026-07-02", "2026-07-01"],
  ["received-on", "2026-07-04", "2026-07-03"],
  ["total", "232.00", "231.00"],
  ["deductible-proportion", "60", "50.00"],
  ["note", "Otra nota", "Con nota"],
  ["line-rate-1", "10", "21.00"],
  ["line-base-0", "90.00", "100"],
  ["line-tax-1", "20.00", "21"],
])(
  "changing %s wakes Save, and typing the stored value back quiets it",
  async (test, changed, original) => {
    const { el } = await mount();
    await type(el, test, changed);
    expect(await state(el)).toEqual(ready);
    await type(el, test, original);
    expect(await state(el)).toEqual(quiet);
  },
);

it("choosing another regime or VAT kind wakes Save, and choosing the stored one back quiets it", async () => {
  const { el } = await mount();
  for (const [name, changed, original] of [
    ["regime", "general", "equivalence_surcharge"],
    ["line-0-kind", "ordinary", "capital"],
  ]) {
    const box = q(el, `wt-combobox[name="${name}"]`)!;
    await chooseOption(box, changed!);
    expect(await state(el), name).toEqual(ready);
    await chooseOption(box, original!);
    expect(await state(el), name).toEqual(quiet);
  }
});

it("adding a line wakes Save, and removing it quiets Save again", async () => {
  const { el } = await mount();
  q(el, "[data-test=add-line]")!.click();
  expect(await state(el)).toEqual(ready);
  q(el, "[data-test=remove-line-2]")!.click();
  expect(await state(el)).toEqual(quiet);
});

it("an edited invoice sends what it holds", async () => {
  const { el, sent } = await mount();
  await type(el, "supplier-name", "Otro SL");
  await press(el);
  expect(sent).toHaveBeenCalledExactlyOnceWith("update-purchase", {
    id: "pi-1",
    patch: {
      header: {
        supplierTaxId: "B99999999",
        supplierName: "Otro SL",
        supplierInvoiceNumber: "E-2026/007",
        issuedOn: "2026-07-01",
        receivedOn: "2026-07-03",
        total: "231.00",
        regime: "equivalence_surcharge",
        deductibleProportion: "50.00",
        note: "Con nota",
      },
      lines: stored.lines,
    },
  });
});

it("a changed new invoice its own checks refuse shows its errors and holds Create primary and disabled", async () => {
  const { el, sent } = await mount(null);
  await type(el, "supplier-name", "Proveedor SL");
  expect(await state(el)).toEqual(ready);
  await press(el);
  expect(sent).not.toHaveBeenCalled();
  expect(errors(el)).toContain(t("purchase.supplier_tax_id_required"));
  expect(await state(el)).toEqual(blocked);
});

it("after a save the person kept editing through, Save is quiet once the sent value is typed back", async () => {
  const { el, sent } = await mount();
  await type(el, "supplier-name", "Otro SL");
  await press(el);
  expect(sent).toHaveBeenCalledOnce();
  const done = el.writeCompletion();
  await type(el, "note", "Más tarde");
  expect(done()).toBe(false);
  expect(await state(el)).toEqual(ready);
  await type(el, "note", "Con nota");
  expect(await state(el)).toEqual(quiet);
});

it("reopened after a save, the stored invoice starts quiet again", async () => {
  const { el } = await mount();
  await type(el, "supplier-name", "Otro SL");
  await press(el);
  expect(el.writeCompletion()()).toBe(true);
  await el.updateComplete;
  el.open = true;
  expect(await state(el)).toEqual(quiet);
  await type(el, "supplier-name", "Otro SL");
  expect(await state(el)).toEqual(ready);
});
