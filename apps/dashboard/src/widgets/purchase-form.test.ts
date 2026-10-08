import { afterEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { chooseOption, formMessageOf } from "@waitron/ui/src/test-helpers.js";
import { codeMessage } from "../i18n/codes.js";
import { setLocale, t } from "../i18n/t.js";
import { regimeName, vatKindName } from "../i18n/domain.js";
import { PurchaseForm, purchaseRefusalErrors } from "./purchase-form.js";
import type { PurchaseInvoice } from "../api/client.js";

afterEach(cleanupWidgets);

function baseProps(overrides: Partial<PurchaseForm> = {}): Partial<PurchaseForm> {
  return { open: true, ...overrides };
}

async function openedDialog(el: PurchaseForm): Promise<HTMLDialogElement> {
  const wtDialog = el.shadowRoot!.querySelector("wt-dialog")!;
  await (wtDialog as unknown as { updateComplete: Promise<unknown> }).updateComplete;
  return wtDialog.shadowRoot!.querySelector("dialog")!;
}

async function setInput(el: PurchaseForm, testId: string, value: string): Promise<void> {
  const input = el.shadowRoot!.querySelector<HTMLElement>(`[data-test=${testId}]`)!;
  input.dispatchEvent(new CustomEvent("wt-change", { detail: { value } }));
  await el.updateComplete;
}

async function setSelect(el: PurchaseForm, testId: string, value: string): Promise<void> {
  await chooseOption(el.shadowRoot!.querySelector(`[data-test=${testId}]`)!, value);
  await el.updateComplete;
}

async function click(el: PurchaseForm, testId: string): Promise<void> {
  el.shadowRoot!.querySelector<HTMLElement>(`[data-test=${testId}]`)!.click();
  await el.updateComplete;
}

async function bottomOf(el: PurchaseForm): Promise<Element | null> {
  const actions = el.shadowRoot!.querySelector("wt-form-actions")!;
  return formMessageOf(actions);
}

const errorOf = (el: PurchaseForm, testId: string): string | null =>
  el.shadowRoot!.querySelector(`[data-test=${testId}]`)!.getAttribute("error");

const confirmOf = (el: PurchaseForm): HTMLElement =>
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm]")!;

/** The message a field of this kind shows when its value is refused. */
const messageFor = (field: string): string =>
  /rate|proportion/.test(field) ? t("purchase.percentage_invalid") : t("purchase.amount_invalid");

async function expectRefused(el: PurchaseForm, field: string, message: string): Promise<void> {
  expect(errorOf(el, field), field).toBe(message);
  expect((await bottomOf(el))?.textContent).toBe(t("form.fix_fields"));
  expect(el.shadowRoot!.querySelector("[role=alert]")).toBeNull();
}

function nextEvent<T>(el: PurchaseForm, type: string): Promise<CustomEvent<T>> {
  return new Promise((resolve) =>
    el.addEventListener(type, (e) => resolve(e as CustomEvent<T>), { once: true }),
  );
}

async function fillHeaderOnly(el: PurchaseForm): Promise<void> {
  await setInput(el, "supplier-tax-id", "B12345678");
  await setInput(el, "supplier-name", "Distribuciones García SL");
  await setInput(el, "supplier-invoice-number", "F-2026/001");
  await setInput(el, "issued-on", "2026-08-10");
  await setInput(el, "received-on", "2026-08-12");
  await setInput(el, "total", "121.00");
}

async function fillValid(el: PurchaseForm): Promise<void> {
  await fillHeaderOnly(el);
  await setInput(el, "line-rate-0", "21.00");
  await setInput(el, "line-base-0", "100.00");
  await setInput(el, "line-tax-0", "21.00");
}

const EDIT_INVOICE: PurchaseInvoice = {
  id: "pi-1",
  supplierTaxId: "B99999999",
  supplierName: "Proveedor Editado SL",
  supplierInvoiceNumber: "E-2026/007",
  issuedOn: "2026-07-01",
  receivedOn: "2026-07-03",
  total: "242.00",
  regime: "equivalence_surcharge",
  deductibleProportion: "50.00",
  note: "Con nota",
  lines: [
    { rate: "10.00", base: "100.00", tax: "10.00", kind: "capital" },
    { rate: "21.00", base: "100.00", tax: "21.00", kind: "ordinary" },
  ],
};

type ChoiceBox = HTMLElement & {
  value: string;
  label: string;
  search: string;
  options: { value: string; label: string }[];
  updateComplete: Promise<unknown>;
};

const boxOf = (el: PurchaseForm, name: string): ChoiceBox =>
  el.shadowRoot!.querySelector<ChoiceBox>(`wt-combobox[name="${name}"]`)!;

/** What a closed dropdown shows on its trigger, not what its properties say it holds. */
async function shownIn(el: PurchaseForm, name: string): Promise<string | undefined> {
  const box = boxOf(el, name);
  await box.updateComplete;
  return box.shadowRoot!.querySelector(".trigger .value")?.textContent?.trim();
}

describe("purchase-form", () => {
  it("picks the VAT regime and each line's VAT kind from shared dropdowns", async () => {
    const { el } = await mountWidget<PurchaseForm>(
      "dashboard-purchase-form",
      baseProps({ invoice: EDIT_INVOICE }),
    );
    await el.updateComplete;
    const regime = boxOf(el, "regime");
    expect(regime).not.toBeNull();
    expect(regime.label).toBe(t("purchase.regime"));
    expect(regime.search).toBe("auto");
    expect(regime.options).toEqual([
      { value: "general", label: regimeName("general", "es-ES") },
      { value: "equivalence_surcharge", label: regimeName("equivalence_surcharge", "es-ES") },
    ]);
    expect(regime.value).toBe("equivalence_surcharge");
    expect(await shownIn(el, "regime")).toBe(regimeName("equivalence_surcharge", "es-ES"));
    const kind = boxOf(el, "line-1-kind");
    expect(kind.label).toBe(t("purchase.line_kind"));
    expect(kind.search).toBe("auto");
    expect(kind.options).toEqual([
      { value: "ordinary", label: vatKindName("ordinary", "es-ES") },
      { value: "capital", label: vatKindName("capital", "es-ES") },
    ]);
    expect(kind.value).toBe("ordinary");
    expect(await shownIn(el, "line-1-kind")).toBe(vatKindName("ordinary", "es-ES"));

    await chooseOption(regime, "general");
    await chooseOption(kind, "capital");
    await el.updateComplete;
    expect(await shownIn(el, "regime")).toBe(regimeName("general", "es-ES"));
    expect(await shownIn(el, "line-1-kind")).toBe(vatKindName("capital", "es-ES"));
    const updated = nextEvent<{ patch: { header: { regime: string }; lines: { kind: string }[] } }>(
      el,
      "update-purchase",
    );
    await click(el, "confirm");
    const { patch } = (await updated).detail;
    expect(patch.header.regime).toBe("general");
    expect(patch.lines.map((line) => line.kind)).toEqual(["capital", "capital"]);
  });

  it("stays closed by default", async () => {
    const { el } = await mountWidget<PurchaseForm>("dashboard-purchase-form", {});
    expect((await openedDialog(el)).open).toBe(false);
  });

  it("opens the dialog when open is set", async () => {
    const { el } = await mountWidget<PurchaseForm>("dashboard-purchase-form", baseProps());
    expect((await openedDialog(el)).open).toBe(true);
  });

  it("offers both regimes and both VAT kinds, localised labels keeping wire values", async () => {
    const { el } = await mountWidget<PurchaseForm>("dashboard-purchase-form", baseProps());
    const regimes = boxOf(el, "regime").options;
    expect(regimes.map((o) => o.value)).toEqual(["general", "equivalence_surcharge"]);
    for (const o of regimes) {
      expect(o.label).toBe(regimeName(o.value, "es-ES"));
    }
    const kinds = boxOf(el, "line-0-kind").options;
    expect(kinds.map((o) => o.value)).toEqual(["ordinary", "capital"]);
    for (const o of kinds) {
      expect(o.label).toBe(vatKindName(o.value, "es-ES"));
    }
  });

  it("starts a create with exactly one blank VAT line", async () => {
    const { el } = await mountWidget<PurchaseForm>("dashboard-purchase-form", baseProps());
    expect(el.shadowRoot!.querySelectorAll("[data-test^=line-rate-]").length).toBe(1);
  });

  it("emits create-purchase with the assembled header + desglose", async () => {
    const { el } = await mountWidget<PurchaseForm>("dashboard-purchase-form", baseProps());
    await fillValid(el);
    const created = nextEvent<{ header: Record<string, unknown>; lines: unknown[] }>(
      el,
      "create-purchase",
    );
    await click(el, "confirm");
    const detail = (await created).detail;
    expect(detail.header).toEqual({
      supplierTaxId: "B12345678",
      supplierName: "Distribuciones García SL",
      supplierInvoiceNumber: "F-2026/001",
      issuedOn: "2026-08-10",
      receivedOn: "2026-08-12",
      total: "121.00",
      regime: "general",
      deductibleProportion: "100.00",
      note: null,
    });
    expect(detail.lines).toEqual([
      { rate: "21.00", base: "100.00", tax: "21.00", kind: "ordinary" },
    ]);
  });

  it("carries a non-empty note, and regime/kind selections, into the create body", async () => {
    const { el } = await mountWidget<PurchaseForm>("dashboard-purchase-form", baseProps());
    await fillValid(el);
    await setInput(el, "note", "Compra de género");
    await setInput(el, "deductible-proportion", "80.00");
    await setSelect(el, "regime", "equivalence_surcharge");
    await setSelect(el, "line-kind-0", "capital");
    const created = nextEvent<{ header: Record<string, unknown>; lines: { kind: string }[] }>(
      el,
      "create-purchase",
    );
    await click(el, "confirm");
    const detail = (await created).detail;
    expect(detail.header).toMatchObject({
      note: "Compra de género",
      deductibleProportion: "80.00",
      regime: "equivalence_surcharge",
    });
    expect(detail.lines[0]!.kind).toBe("capital");
  });

  it("adds and removes VAT lines and sends them all", async () => {
    const { el } = await mountWidget<PurchaseForm>("dashboard-purchase-form", baseProps());
    await fillValid(el);
    await click(el, "add-line");
    await setInput(el, "line-rate-1", "10.00");
    await setInput(el, "line-base-1", "50.00");
    await setInput(el, "line-tax-1", "5.00");
    await click(el, "add-line");
    expect(el.shadowRoot!.querySelectorAll("[data-test^=line-rate-]").length).toBe(3);
    await click(el, "remove-line-2");
    expect(el.shadowRoot!.querySelectorAll("[data-test^=line-rate-]").length).toBe(2);

    const created = nextEvent<{ lines: unknown[] }>(el, "create-purchase");
    await click(el, "confirm");
    expect((await created).detail.lines).toEqual([
      { rate: "21.00", base: "100.00", tax: "21.00", kind: "ordinary" },
      { rate: "10.00", base: "50.00", tax: "5.00", kind: "ordinary" },
    ]);
  });

  it("blocks confirm and shows each empty required header field's own error under it", async () => {
    const { el } = await mountWidget<PurchaseForm>("dashboard-purchase-form", baseProps());
    let fired = false;
    el.addEventListener("create-purchase", () => (fired = true));
    await setInput(el, "supplier-name", "   ");
    await click(el, "confirm");
    expect(fired).toBe(false);
    for (const [field, key] of [
      ["supplier-tax-id", "purchase.supplier_tax_id_required"],
      ["supplier-name", "purchase.supplier_name_required"],
      ["supplier-invoice-number", "purchase.supplier_invoice_number_required"],
      ["issued-on", "purchase.issued_on_required"],
      ["received-on", "purchase.received_on_required"],
    ] as const)
      expect(errorOf(el, field), field).toBe(t(key));
    expect(errorOf(el, "total")).toBe(t("purchase.amount_invalid"));
    expect(errorOf(el, "note")).toBe("");
    expect((await bottomOf(el))!.getAttribute("role")).toBe("alert");
    expect((await bottomOf(el))!.textContent).toBe(t("form.fix_fields"));
    expect(el.shadowRoot!.querySelector("[role=alert]")).toBeNull();
  });

  it("blocks confirm with lines_required under the VAT breakdown when every line is removed", async () => {
    const { el } = await mountWidget<PurchaseForm>("dashboard-purchase-form", baseProps());
    await setInput(el, "supplier-tax-id", "B1");
    await setInput(el, "supplier-name", "X");
    await setInput(el, "supplier-invoice-number", "N1");
    await setInput(el, "issued-on", "2026-08-10");
    await setInput(el, "received-on", "2026-08-12");
    await setInput(el, "total", "0.00");
    await click(el, "remove-line-0");
    let fired = false;
    el.addEventListener("create-purchase", () => (fired = true));
    await click(el, "confirm");
    expect(fired).toBe(false);
    expect(el.shadowRoot!.querySelector("[data-test=lines-error]")!.textContent).toContain(
      codeMessage("purchase.lines_required", "es-ES"),
    );
    expect((await bottomOf(el))!.textContent).toBe(t("form.fix_fields"));
    expect(confirmOf(el).hasAttribute("disabled")).toBe(true);

    await click(el, "add-line");
    expect(el.shadowRoot!.querySelector("[data-test=lines-error]")).toBeNull();
  });

  it.each([
    ["negative base", { field: "line-base-0", value: "-1.00" }],
    ["negative tax", { field: "line-tax-0", value: "-1.00" }],
    ["rate above 100", { field: "line-rate-0", value: "150.00" }],
    ["non-numeric base", { field: "line-base-0", value: "abc" }],
  ])("blocks confirm with the amount's error under it on %s", async (_label, { field, value }) => {
    const { el } = await mountWidget<PurchaseForm>("dashboard-purchase-form", baseProps());
    await fillValid(el);
    await setInput(el, field, value);
    let fired = false;
    el.addEventListener("create-purchase", () => (fired = true));
    await click(el, "confirm");
    expect(fired).toBe(false);
    await expectRefused(el, field, messageFor(field));
  });

  it("blocks confirm with the proportion's error under it when it is out of range", async () => {
    const { el } = await mountWidget<PurchaseForm>("dashboard-purchase-form", baseProps());
    await fillValid(el);
    await setInput(el, "deductible-proportion", "150");
    let fired = false;
    el.addEventListener("create-purchase", () => (fired = true));
    await click(el, "confirm");
    expect(fired).toBe(false);
    await expectRefused(el, "deductible-proportion", t("purchase.percentage_invalid"));
  });

  // ── Empty / non-decimal amounts, caught client-side so the operator is told which one is wrong ──

  it("blocks confirm on the default single BLANK VAT line, marking each of its amounts, before any round trip", async () => {
    const { el } = await mountWidget<PurchaseForm>("dashboard-purchase-form", baseProps());
    await fillHeaderOnly(el); // header valid; the auto-present first line is left blank
    let fired = false;
    el.addEventListener("create-purchase", () => (fired = true));
    await click(el, "confirm");
    expect(fired).toBe(false);
    for (const field of ["line-rate-0", "line-base-0", "line-tax-0"])
      await expectRefused(el, field, messageFor(field));
  });

  it.each([
    ["empty base", { field: "line-base-0", value: "" }],
    ["whitespace tax", { field: "line-tax-0", value: "  " }],
    ["comma-decimal base", { field: "line-base-0", value: "100,00" }],
    ["comma-decimal total", { field: "total", value: "121,00" }],
    ["comma-decimal proportion", { field: "deductible-proportion", value: "50,5" }],
  ])(
    "blocks confirm with the field's error under it on a %s, before any round trip",
    async (_label, { field, value }) => {
      const { el } = await mountWidget<PurchaseForm>("dashboard-purchase-form", baseProps());
      await fillValid(el);
      await setInput(el, field, value);
      let fired = false;
      el.addEventListener("create-purchase", () => (fired = true));
      await click(el, "confirm");
      expect(fired).toBe(false);
      await expectRefused(el, field, messageFor(field));
    },
  );

  // A leading dot (`.5`) and a leading zero (`01.00`) are well-formed to a human and refused by the
  // server: `decimal()` accepts neither.
  it.each([
    ["leading-dot total", { field: "total", value: ".5" }],
    ["leading-zero total", { field: "total", value: "01.00" }],
    ["leading-dot line base", { field: "line-base-0", value: ".5" }],
    ["leading-zero line base", { field: "line-base-0", value: "01.00" }],
  ])(
    "blocks confirm with the field's error under it on a %s, which the server would refuse",
    async (_label, { field, value }) => {
      const { el } = await mountWidget<PurchaseForm>("dashboard-purchase-form", baseProps());
      await fillValid(el);
      await setInput(el, field, value);
      let fired = false;
      el.addEventListener("create-purchase", () => (fired = true));
      await click(el, "confirm");
      expect(fired).toBe(false);
      await expectRefused(el, field, messageFor(field));
    },
  );

  it("blocks a whitespace total with the total's error under it, never reaching the server", async () => {
    const { el } = await mountWidget<PurchaseForm>("dashboard-purchase-form", baseProps());
    await fillValid(el);
    await setInput(el, "total", "  ");
    let fired = false;
    el.addEventListener("create-purchase", () => (fired = true));
    await click(el, "confirm");
    expect(fired).toBe(false);
    await expectRefused(el, "total", t("purchase.amount_invalid"));
  });

  it.each(["0.5", "21.00", "0", "100"])(
    "still emits create-purchase for a valid dot-decimal total %s",
    async (total) => {
      const { el } = await mountWidget<PurchaseForm>("dashboard-purchase-form", baseProps());
      await fillValid(el);
      await setInput(el, "total", total);
      let fired = false;
      el.addEventListener("create-purchase", () => (fired = true));
      await click(el, "confirm");
      expect(fired).toBe(true);
    },
  );

  it("clears a header or line field's error once that field is fixed after a failed confirm", async () => {
    const { el } = await mountWidget<PurchaseForm>("dashboard-purchase-form", baseProps());
    await setInput(el, "supplier-tax-id", "   ");
    await click(el, "confirm");
    expect(errorOf(el, "supplier-name")).not.toBe("");
    await setInput(el, "supplier-name", "Proveedor");
    expect(errorOf(el, "supplier-name")).toBe("");
    expect(errorOf(el, "supplier-tax-id")).not.toBe("");

    expect(errorOf(el, "line-rate-0")).not.toBe("");
    await setInput(el, "line-rate-0", "21.00");
    expect(errorOf(el, "line-rate-0")).toBe("");
  });

  it("says nothing about errors before the first submission, and Create works", async () => {
    const { el } = await mountWidget<PurchaseForm>("dashboard-purchase-form", baseProps());
    await setInput(el, "total", "abc");
    expect(errorOf(el, "total")).toBe("");
    expect(await bottomOf(el)).toBeNull();
    expect(confirmOf(el).hasAttribute("disabled")).toBe(false);
  });

  it("marks every field the invoice needs as required", async () => {
    const { el } = await mountWidget<PurchaseForm>("dashboard-purchase-form", baseProps());
    const required = [...el.shadowRoot!.querySelectorAll("[required]")].map((field) =>
      field.getAttribute("data-test"),
    );
    expect(required).toEqual([
      "supplier-tax-id",
      "supplier-name",
      "supplier-invoice-number",
      "issued-on",
      "received-on",
      "total",
      "deductible-proportion",
      "line-rate-0",
      "line-base-0",
      "line-tax-0",
    ]);
  });

  it("on an invalid submission focuses the first invalid field and keeps Create disabled until every field is fixed", async () => {
    const { el } = await mountWidget<PurchaseForm>("dashboard-purchase-form", baseProps());
    await setInput(el, "supplier-tax-id", "B12345678");
    await click(el, "confirm");
    await new Promise((resolve) => setTimeout(resolve));
    const name = el.shadowRoot!.querySelector("[data-test=supplier-name]")!;
    expect(name.shadowRoot!.activeElement).toBe(name.shadowRoot!.querySelector("input"));
    expect(confirmOf(el).hasAttribute("disabled")).toBe(true);

    await fillValid(el);
    await setInput(el, "total", "abc");
    expect(confirmOf(el).hasAttribute("disabled")).toBe(true);
    expect((await bottomOf(el))!.textContent).toBe(t("form.fix_fields"));

    await setInput(el, "total", "121.00");
    expect(confirmOf(el).hasAttribute("disabled")).toBe(false);
    expect(await bottomOf(el)).toBeNull();
    const created = nextEvent(el, "create-purchase");
    await click(el, "confirm");
    expect((await created).type).toBe("create-purchase");
  });

  it("starts again when reopened: no messages and Create working", async () => {
    const { el } = await mountWidget<PurchaseForm>("dashboard-purchase-form", baseProps());
    await setInput(el, "supplier-name", "   ");
    await click(el, "confirm");
    expect(errorOf(el, "supplier-name")).not.toBe("");
    el.open = false;
    await el.updateComplete;
    el.open = true;
    await el.updateComplete;
    expect(errorOf(el, "supplier-name")).toBe("");
    expect(await bottomOf(el)).toBeNull();
    expect(confirmOf(el).hasAttribute("disabled")).toBe(true);
    await setInput(el, "supplier-name", "Proveedor");
    expect(errorOf(el, "supplier-tax-id")).toBe("");
    expect(confirmOf(el).hasAttribute("disabled")).toBe(false);
  });

  it("changes the kind of one line without touching the others (multi-line desglose)", async () => {
    const { el } = await mountWidget<PurchaseForm>("dashboard-purchase-form", baseProps());
    await fillValid(el);
    await click(el, "add-line");
    await setInput(el, "line-rate-1", "10.00");
    await setInput(el, "line-base-1", "50.00");
    await setInput(el, "line-tax-1", "5.00");
    await setSelect(el, "line-kind-1", "capital");
    const created = nextEvent<{ lines: { kind: string }[] }>(el, "create-purchase");
    await click(el, "confirm");
    const lines = (await created).detail.lines;
    expect(lines.map((l) => l.kind)).toEqual(["ordinary", "capital"]);
  });

  it("emits create-purchase as a bubbling, composed event", async () => {
    const { el } = await mountWidget<PurchaseForm>("dashboard-purchase-form", baseProps());
    await fillValid(el);
    const seen = nextEvent(el, "create-purchase");
    await click(el, "confirm");
    const event = await seen;
    expect(event.bubbles).toBe(true);
    expect(event.composed).toBe(true);
  });

  it("ignores a confirm while busy (single-flight)", async () => {
    const { el } = await mountWidget<PurchaseForm>(
      "dashboard-purchase-form",
      baseProps({ busy: true }),
    );
    await fillValid(el);
    let fired = false;
    el.addEventListener("create-purchase", () => (fired = true));
    await click(el, "confirm");
    expect(fired).toBe(false);
  });

  // ── Edit mode ─────────────────────────────────────────────────────────────────────────────────

  it("pre-fills every field and every VAT line from a passed invoice", async () => {
    const { el } = await mountWidget<PurchaseForm>("dashboard-purchase-form", {
      open: true,
      invoice: EDIT_INVOICE,
    });
    await el.updateComplete;
    const value = (id: string) =>
      el.shadowRoot!.querySelector<HTMLElement & { value: string }>(`[data-test=${id}]`)!.value;
    const sel = (id: string) => el.shadowRoot!.querySelector<ChoiceBox>(`[data-test=${id}]`)!.value;
    expect(value("supplier-tax-id")).toBe("B99999999");
    expect(value("supplier-name")).toBe("Proveedor Editado SL");
    expect(value("supplier-invoice-number")).toBe("E-2026/007");
    expect(value("issued-on")).toBe("2026-07-01");
    expect(value("received-on")).toBe("2026-07-03");
    expect(value("total")).toBe("242.00");
    expect(sel("regime")).toBe("equivalence_surcharge");
    expect(await shownIn(el, "regime")).toBe(regimeName("equivalence_surcharge", "es-ES"));
    expect(value("deductible-proportion")).toBe("50.00");
    expect(value("note")).toBe("Con nota");
    expect(el.shadowRoot!.querySelectorAll("[data-test^=line-rate-]").length).toBe(2);
    expect(value("line-rate-0")).toBe("10.00");
    expect(sel("line-kind-0")).toBe("capital");
    expect(await shownIn(el, "line-0-kind")).toBe(vatKindName("capital", "es-ES"));
    expect(value("line-rate-1")).toBe("21.00");
  });

  it("emits update-purchase with the id and a full header + lines patch in edit mode", async () => {
    const { el } = await mountWidget<PurchaseForm>("dashboard-purchase-form", {
      open: true,
      invoice: EDIT_INVOICE,
    });
    await el.updateComplete;
    const updated = nextEvent<{ id: string; patch: Record<string, unknown> }>(
      el,
      "update-purchase",
    );
    await setInput(el, "note", "Nota nueva");
    await click(el, "confirm");
    const detail = (await updated).detail;
    expect(detail.id).toBe("pi-1");
    expect(detail.patch).toEqual({
      header: {
        supplierTaxId: "B99999999",
        supplierName: "Proveedor Editado SL",
        supplierInvoiceNumber: "E-2026/007",
        issuedOn: "2026-07-01",
        receivedOn: "2026-07-03",
        total: "242.00",
        regime: "equivalence_surcharge",
        deductibleProportion: "50.00",
        note: "Nota nueva",
      },
      lines: [
        { rate: "10.00", base: "100.00", tax: "10.00", kind: "capital" },
        { rate: "21.00", base: "100.00", tax: "21.00", kind: "ordinary" },
      ],
    });
  });

  it("gives every control it draws a semantic name, numbering each VAT line's", async () => {
    const { el } = await mountWidget<PurchaseForm>(
      "dashboard-purchase-form",
      baseProps({ invoice: EDIT_INVOICE }),
    );
    await el.updateComplete;
    const fields = [...el.shadowRoot!.querySelectorAll<HTMLElement>("wt-input, wt-price-input")];
    await Promise.all(
      fields.map(
        (field) => (field as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete,
      ),
    );
    const controls = [
      ...el.shadowRoot!.querySelectorAll(
        "input, select, textarea, wt-input, wt-price-input, wt-combobox",
      ),
    ].flatMap((node) =>
      node.localName === "wt-combobox"
        ? [node.shadowRoot!.querySelector("button.trigger")!]
        : node.shadowRoot
          ? [...node.shadowRoot.querySelectorAll("input, select, textarea")]
          : [node],
    ) as (HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | HTMLButtonElement)[];
    expect(controls.map((control) => control.name)).toEqual([
      "supplier-tax-id",
      "supplier-name",
      "supplier-invoice-number",
      "issued-on",
      "received-on",
      "total",
      "regime",
      "deductible-proportion",
      "note",
      "line-0-rate",
      "line-0-base",
      "line-0-tax",
      "line-0-kind",
      "line-1-rate",
      "line-1-base",
      "line-1-tax",
      "line-1-kind",
    ]);
    for (const control of controls) expect(control.id, control.name).not.toMatch(/^wt-/);
  });

  it("resets open to false when the dialog is closed (wt-close)", async () => {
    const { el } = await mountWidget<PurchaseForm>("dashboard-purchase-form", baseProps());
    const nativeDialog = await openedDialog(el);
    const closed = new Promise<void>((resolve) =>
      el.addEventListener("wt-close", () => resolve(), { once: true }),
    );
    nativeDialog.close();
    await closed;
    await el.updateComplete;
    expect(el.open).toBe(false);
  });
});

describe("purchase-form keyboard submit", () => {
  it("confirms on Enter in a field", async () => {
    const { el } = await mountWidget<PurchaseForm>("dashboard-purchase-form", baseProps());
    await fillValid(el);
    const events: CustomEvent[] = [];
    el.addEventListener("create-purchase", (event) => events.push(event as CustomEvent));
    const field = el.shadowRoot!.querySelector<HTMLElement & { updateComplete: Promise<unknown> }>(
      "[data-test=supplier-name]",
    )!;
    await field.updateComplete;
    field.shadowRoot!.querySelector("input")!.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        composed: true,
        cancelable: true,
      }),
    );
    expect(events).toHaveLength(1);
    expect(events[0]!.detail.header.supplierName).toBe("Distribuciones García SL");
    expect(events[0]!.detail.lines).toEqual([
      { rate: "21.00", base: "100.00", tax: "21.00", kind: "ordinary" },
    ]);
  });
});

describe("purchase-form — money fields", () => {
  afterEach(() => setLocale("es-ES"));

  type MoneyField = HTMLElement & { label: string; value: string };
  const MONEY = [
    ["total", "purchase.total", "242.00"],
    ["line-base-0", "purchase.line_base", "100.00"],
    ["line-tax-0", "purchase.line_tax", "10.00"],
    ["line-base-1", "purchase.line_base", "100.00"],
    ["line-tax-1", "purchase.line_tax", "21.00"],
  ] as const;

  it.each([
    ["es-ES", "after"],
    ["en-GB", "before"],
  ])(
    "draws the euro sign in the total and each line's base and tax, where %s writes it",
    async (locale, side) => {
      setLocale(locale);
      const { el } = await mountWidget<PurchaseForm>("dashboard-purchase-form", {
        open: true,
        invoice: EDIT_INVOICE,
      });
      await el.updateComplete;
      for (const [id, label, value] of MONEY) {
        const field = el.shadowRoot!.querySelector<MoneyField>(`[data-test=${id}]`)!;
        await (field as MoneyField & { updateComplete: Promise<unknown> }).updateComplete;
        expect(field.tagName, id).toBe("WT-PRICE-INPUT");
        expect(field.label, id).toBe(t(label));
        expect(field.value, id).toBe(value);
        const sign = field.shadowRoot!.querySelector("[part=currency]");
        expect(sign?.textContent, id).toBe("€");
        const amount = field.shadowRoot!.querySelector("[part=amount]")!.getBoundingClientRect();
        const signLeft = sign!.getBoundingClientRect().left;
        expect(signLeft < amount.left + amount.width / 2 ? "before" : "after", id).toBe(side);
        expect(field.shadowRoot!.querySelector("button"), `${id} has no unit button`).toBeNull();
      }
      for (const id of ["line-rate-0", "deductible-proportion"]) {
        expect(el.shadowRoot!.querySelector(`[data-test=${id}]`)!.tagName, id).toBe("WT-INPUT");
      }
    },
  );

  it.each(["en-GB", "es-ES"])(
    "on a phone in %s, a VAT line wraps its fields rather than overlapping or cutting them",
    async (locale) => {
      const width = window.innerWidth,
        height = window.innerHeight;
      try {
        setLocale(locale);
        await page.viewport(390, 844);
        const big = { rate: "21.00", base: "10000.00", tax: "10000.00", kind: "capital" as const };
        const { el } = await mountWidget<PurchaseForm>("dashboard-purchase-form", {
          open: true,
          invoice: { ...EDIT_INVOICE, lines: [big] },
        });
        // The field measures its sign after layout, and sizes its amount box then.
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const line = el.shadowRoot!.querySelector<HTMLElement>("[data-test=line-0]")!;
        const row = line.getBoundingClientRect();
        const boxes = (Array.from(line.children) as HTMLElement[]).map((child) => {
          const amount = child.shadowRoot?.querySelector("[part=amount]");
          return { child, box: (amount ?? child).getBoundingClientRect() };
        });
        for (const [i, { child, box }] of boxes.entries()) {
          const at = `${locale} ${child.dataset.test ?? child.tagName}`;
          expect(box.right, `${at} runs past the line`).toBeLessThanOrEqual(row.right + 0.5);
          for (const { child: other, box: next } of boxes.slice(i + 1)) {
            const apart =
              next.left >= box.right - 0.5 ||
              next.right <= box.left + 0.5 ||
              next.top >= box.bottom - 0.5 ||
              next.bottom <= box.top + 0.5;
            expect(apart, `${at} overlaps ${other.dataset.test ?? other.tagName}`).toBe(true);
          }
        }
        for (const id of ["line-base-0", "line-tax-0"]) {
          const input = el
            .shadowRoot!.querySelector(`[data-test=${id}]`)!
            .shadowRoot!.querySelector("input")!;
          expect(input.scrollWidth, `${locale} ${id} is cut off`).toBeLessThanOrEqual(
            input.clientWidth,
          );
        }
        const kind = el
          .shadowRoot!.querySelector("[data-test=line-kind-0]")!
          .shadowRoot!.querySelector<HTMLElement>(".trigger .value")!;
        expect(kind.textContent!.trim()).toBe(vatKindName("capital", locale));
        expect(kind.scrollWidth, `${locale} the VAT type is cut off`).toBeLessThanOrEqual(
          kind.clientWidth,
        );
      } finally {
        await page.viewport(width, height);
      }
    },
  );
});

describe("purchase-form — a server refusal", () => {
  const invalidRequest = codeMessage("management.request_invalid");
  it.each([
    [{ field: "supplierTaxId" }, "supplier-tax-id"],
    [{ field: "supplierName" }, "supplier-name"],
    [{ field: "supplierInvoiceNumber" }, "supplier-invoice-number"],
    [{ field: "issuedOn" }, "issued-on"],
    [{ field: "receivedOn" }, "received-on"],
    [{ field: "total" }, "total"],
    [{ field: "deductibleProportion" }, "deductible-proportion"],
    [{ field: "note" }, "note"],
  ])("keys an invalid request naming %o under %s", (params, key) => {
    expect(purchaseRefusalErrors({ code: "management.request_invalid", params })).toEqual({
      [key]: invalidRequest,
    });
  });

  it("keys a range refusal by the field it concerns, and anything naming no shown field to the form", () => {
    const invalid = codeMessage("purchase.invalid");
    expect(
      purchaseRefusalErrors({
        code: "purchase.invalid",
        params: { reason: "proportion_out_of_range" },
      }),
    ).toEqual({ "deductible-proportion": invalid });
    expect(
      purchaseRefusalErrors({ code: "purchase.invalid", params: { reason: "no_lines" } }),
    ).toEqual({ lines: invalid });
    // A line's refusal carries no line number, so no field can hold it.
    expect(
      purchaseRefusalErrors({ code: "purchase.invalid", params: { reason: "negative_base" } }),
    ).toEqual({ _form: invalid });
    expect(
      purchaseRefusalErrors({ code: "management.request_invalid", params: { field: "rate" } }),
    ).toEqual({ _form: invalidRequest });
    expect(
      purchaseRefusalErrors({
        code: "purchase.duplicate",
        params: { supplierTaxId: "B1", supplierInvoiceNumber: "N-1" },
      }),
    ).toEqual({ _form: codeMessage("purchase.duplicate") });
    expect(purchaseRefusalErrors({})).toEqual({ _form: codeMessage("server.internal") });
  });

  it("shows a refused field's message under it, focuses it, and leaves Create working", async () => {
    const { el } = await mountWidget<PurchaseForm>("dashboard-purchase-form", baseProps());
    await fillValid(el);
    el.fieldErrors = { "deductible-proportion": "Refused proportion" };
    await el.updateComplete;
    await new Promise((resolve) => setTimeout(resolve));

    expect(errorOf(el, "deductible-proportion")).toBe("Refused proportion");
    expect((await bottomOf(el))?.textContent).toBe(t("form.fix_fields"));
    expect(confirmOf(el).hasAttribute("disabled")).toBe(false);
    const field = el.shadowRoot!.querySelector("[data-test=deductible-proportion]")!;
    expect(field.shadowRoot!.activeElement).toBe(field.shadowRoot!.querySelector("input"));

    // Another field changing leaves it standing.
    await setInput(el, "supplier-name", "Otro proveedor");
    expect(errorOf(el, "deductible-proportion")).toBe("Refused proportion");

    await setInput(el, "deductible-proportion", "50.00");
    expect(errorOf(el, "deductible-proportion")).toBe("");
    expect(await bottomOf(el)).toBeNull();
    expect(confirmOf(el).hasAttribute("disabled")).toBe(false);
  });

  it("clears a refused note's invalid state and message once the note is edited", async () => {
    const { el } = await mountWidget<PurchaseForm>("dashboard-purchase-form", baseProps());
    await fillValid(el);
    el.fieldErrors = { note: "Refused note" };
    await el.updateComplete;
    const note = el.shadowRoot!.querySelector<HTMLElement & { updateComplete: Promise<unknown> }>(
      "[data-test=note]",
    )!;
    await note.updateComplete;
    const input = note.shadowRoot!.querySelector("input")!;
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(note.shadowRoot!.querySelector("[data-error]")?.textContent).toBe("Refused note");

    await setInput(el, "note", "Otra nota");
    await note.updateComplete;
    expect(input.getAttribute("aria-invalid")).toBe("false");
    expect(note.shadowRoot!.querySelector("[data-error]")).toBeNull();
    expect(confirmOf(el).hasAttribute("disabled")).toBe(false);
  });

  it("drops a refusal of the lines when a line is added", async () => {
    const { el } = await mountWidget<PurchaseForm>("dashboard-purchase-form", baseProps());
    await fillValid(el);
    el.fieldErrors = { lines: "Refused lines" };
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("[data-test=lines-error]")?.textContent).toBe(
      "Refused lines",
    );
    expect(confirmOf(el).hasAttribute("disabled")).toBe(false);

    await click(el, "add-line");
    expect(el.shadowRoot!.querySelector("[data-test=lines-error]")).toBeNull();
  });

  it("says a refusal naming no field in the bottom message, leaves Create working, and drops it on the next submit", async () => {
    const { el } = await mountWidget<PurchaseForm>("dashboard-purchase-form", baseProps());
    await fillValid(el);
    el.fieldErrors = { _form: codeMessage("purchase.duplicate") };
    await el.updateComplete;

    const bottom = await bottomOf(el);
    expect(bottom?.getAttribute("role")).toBe("alert");
    expect(bottom?.textContent).toBe(codeMessage("purchase.duplicate"));
    expect(confirmOf(el).hasAttribute("disabled")).toBe(false);

    const created = nextEvent(el, "create-purchase");
    await click(el, "confirm");
    expect((await created).type).toBe("create-purchase");
    expect(await bottomOf(el)).toBeNull();
  });
});

for (const locale of ["en", "es"]) {
  it(`decimal input in purchase rates and amounts follows ${locale}`, async () => {
    setLocale(locale);
    const { el } = await mountWidget<PurchaseForm>(
      "dashboard-purchase-form",
      baseProps({ invoice: EDIT_INVOICE }),
    );
    const emitted: unknown[] = [];
    el.addEventListener("update-purchase", (event) => emitted.push((event as CustomEvent).detail));
    for (const [id, saved] of [
      ["line-rate-0", "10.00"],
      ["deductible-proportion", "50.00"],
      ["line-base-0", "100.00"],
      ["line-tax-0", "10.00"],
      ["total", "242.00"],
    ]) {
      const control = el.shadowRoot!.querySelector<
        HTMLElement & { updateComplete: Promise<unknown> }
      >(`[data-test=${id}]`)!;
      await control.updateComplete;
      const native = control.shadowRoot!.querySelector("input")!;
      expect(native.value, id).toBe(locale === "es" ? saved!.replace(".", ",") : saved);
      for (const separator of [".", ","]) {
        native.value = saved!.replace(".", separator);
        native.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
        await el.updateComplete;
        await control.updateComplete;
        expect(native.value, id).toBe(locale === "es" ? saved!.replace(".", ",") : saved);
      }
    }
    expect(confirmOf(el).hasAttribute("disabled")).toBe(true);
    await setInput(el, "note", "Nota nueva");
    await click(el, "confirm");
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({
      patch: {
        header: { total: "242.00", deductibleProportion: "50.00" },
        lines: [
          { rate: "10.00", base: "100.00", tax: "10.00" },
          { rate: "21.00", base: "100.00", tax: "21.00" },
        ],
      },
    });
  });
}
