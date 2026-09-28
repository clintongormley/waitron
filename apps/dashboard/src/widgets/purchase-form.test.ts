import { afterEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { codeMessage } from "../i18n/codes.js";
import { setLocale, t } from "../i18n/t.js";
import { regimeName, vatKindName } from "../i18n/domain.js";
import { PurchaseForm } from "./purchase-form.js";
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
  const select = el.shadowRoot!.querySelector<HTMLSelectElement>(`[data-test=${testId}]`)!;
  select.value = value;
  select.dispatchEvent(new Event("change"));
  await el.updateComplete;
}

async function click(el: PurchaseForm, testId: string): Promise<void> {
  el.shadowRoot!.querySelector<HTMLElement>(`[data-test=${testId}]`)!.click();
  await el.updateComplete;
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

describe("purchase-form", () => {
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
    const regimes = [
      ...el.shadowRoot!.querySelectorAll<HTMLOptionElement>("[data-test=regime] option"),
    ];
    expect(regimes.map((o) => o.value)).toEqual(["general", "equivalence_surcharge"]);
    for (const o of regimes) {
      expect(o.textContent!.trim()).toBe(regimeName(o.value, "es-ES"));
    }
    const kinds = [
      ...el.shadowRoot!.querySelectorAll<HTMLOptionElement>("[data-test=line-kind-0] option"),
    ];
    expect(kinds.map((o) => o.value)).toEqual(["ordinary", "capital"]);
    for (const o of kinds) {
      expect(o.textContent!.trim()).toBe(vatKindName(o.value, "es-ES"));
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

  it("blocks confirm and shows a localised error when required header fields are empty", async () => {
    const { el } = await mountWidget<PurchaseForm>("dashboard-purchase-form", baseProps());
    let fired = false;
    el.addEventListener("create-purchase", () => (fired = true));
    await click(el, "confirm");
    expect(fired).toBe(false);
    const alert = el.shadowRoot!.querySelector("[role=alert]")!;
    expect(alert.textContent).toContain(codeMessage("purchase.fields_required", "es-ES"));
    expect(alert.textContent).not.toContain("purchase.fields_required");
  });

  it("blocks confirm with lines_required when every line is removed", async () => {
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
    expect(el.shadowRoot!.querySelector("[role=alert]")!.textContent).toContain(
      codeMessage("purchase.lines_required", "es-ES"),
    );
  });

  it.each([
    ["negative base", { field: "line-base-0", value: "-1.00" }],
    ["negative tax", { field: "line-tax-0", value: "-1.00" }],
    ["rate above 100", { field: "line-rate-0", value: "150.00" }],
    ["non-numeric base", { field: "line-base-0", value: "abc" }],
  ])("blocks confirm with amounts_invalid on %s", async (_label, { field, value }) => {
    const { el } = await mountWidget<PurchaseForm>("dashboard-purchase-form", baseProps());
    await fillValid(el);
    await setInput(el, field, value);
    let fired = false;
    el.addEventListener("create-purchase", () => (fired = true));
    await click(el, "confirm");
    expect(fired).toBe(false);
    expect(el.shadowRoot!.querySelector("[role=alert]")!.textContent).toContain(
      codeMessage("purchase.amounts_invalid", "es-ES"),
    );
  });

  it("blocks confirm with amounts_invalid when the deductible proportion is out of range", async () => {
    const { el } = await mountWidget<PurchaseForm>("dashboard-purchase-form", baseProps());
    await fillValid(el);
    await setInput(el, "deductible-proportion", "150");
    let fired = false;
    el.addEventListener("create-purchase", () => (fired = true));
    await click(el, "confirm");
    expect(fired).toBe(false);
    expect(el.shadowRoot!.querySelector("[role=alert]")!.textContent).toContain(
      codeMessage("purchase.amounts_invalid", "es-ES"),
    );
  });

  // ── Empty / non-decimal amounts, caught client-side so the operator is told which one is wrong ──

  it("blocks confirm on the default single BLANK VAT line (amounts_invalid, before any round trip)", async () => {
    const { el } = await mountWidget<PurchaseForm>("dashboard-purchase-form", baseProps());
    await fillHeaderOnly(el); // header valid; the auto-present first line is left blank
    let fired = false;
    el.addEventListener("create-purchase", () => (fired = true));
    await click(el, "confirm");
    expect(fired).toBe(false);
    expect(el.shadowRoot!.querySelector("[role=alert]")!.textContent).toContain(
      codeMessage("purchase.amounts_invalid", "es-ES"),
    );
  });

  it.each([
    ["empty base", { field: "line-base-0", value: "" }],
    ["whitespace tax", { field: "line-tax-0", value: "  " }],
    ["comma-decimal base", { field: "line-base-0", value: "100,00" }],
    ["comma-decimal total", { field: "total", value: "121,00" }],
    ["comma-decimal proportion", { field: "deductible-proportion", value: "50,5" }],
  ])(
    "blocks confirm with amounts_invalid on a %s, before any round trip",
    async (_label, { field, value }) => {
      const { el } = await mountWidget<PurchaseForm>("dashboard-purchase-form", baseProps());
      await fillValid(el);
      await setInput(el, field, value);
      let fired = false;
      el.addEventListener("create-purchase", () => (fired = true));
      await click(el, "confirm");
      expect(fired).toBe(false);
      expect(el.shadowRoot!.querySelector("[role=alert]")!.textContent).toContain(
        codeMessage("purchase.amounts_invalid", "es-ES"),
      );
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
    "blocks confirm with amounts_invalid on a %s, which the server would refuse",
    async (_label, { field, value }) => {
      const { el } = await mountWidget<PurchaseForm>("dashboard-purchase-form", baseProps());
      await fillValid(el);
      await setInput(el, field, value);
      let fired = false;
      el.addEventListener("create-purchase", () => (fired = true));
      await click(el, "confirm");
      expect(fired).toBe(false);
      expect(el.shadowRoot!.querySelector("[role=alert]")!.textContent).toContain(
        codeMessage("purchase.amounts_invalid", "es-ES"),
      );
    },
  );

  // A blank/whitespace TOTAL is a missing REQUIRED field, so the required-field check (which runs
  // first) wins.
  it("blocks a whitespace total as fields_required, never reaching the server", async () => {
    const { el } = await mountWidget<PurchaseForm>("dashboard-purchase-form", baseProps());
    await fillValid(el);
    await setInput(el, "total", "  ");
    let fired = false;
    el.addEventListener("create-purchase", () => (fired = true));
    await click(el, "confirm");
    expect(fired).toBe(false);
    expect(el.shadowRoot!.querySelector("[role=alert]")!.textContent).toContain(
      codeMessage("purchase.fields_required", "es-ES"),
    );
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

  it("clears the validation error once a header or line field is edited after a failed confirm", async () => {
    const { el } = await mountWidget<PurchaseForm>("dashboard-purchase-form", baseProps());
    await click(el, "confirm");
    expect(el.shadowRoot!.querySelector("[role=alert]")).not.toBeNull();
    await setInput(el, "supplier-name", "Proveedor");
    expect(el.shadowRoot!.querySelector("[role=alert]")).toBeNull();

    await click(el, "confirm");
    expect(el.shadowRoot!.querySelector("[role=alert]")).not.toBeNull();
    await setInput(el, "line-rate-0", "21.00");
    expect(el.shadowRoot!.querySelector("[role=alert]")).toBeNull();
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
    const sel = (id: string) =>
      el.shadowRoot!.querySelector<HTMLSelectElement>(`[data-test=${id}]`)!.value;
    expect(value("supplier-tax-id")).toBe("B99999999");
    expect(value("supplier-name")).toBe("Proveedor Editado SL");
    expect(value("supplier-invoice-number")).toBe("E-2026/007");
    expect(value("issued-on")).toBe("2026-07-01");
    expect(value("received-on")).toBe("2026-07-03");
    expect(value("total")).toBe("242.00");
    expect(sel("regime")).toBe("equivalence_surcharge");
    expect(value("deductible-proportion")).toBe("50.00");
    expect(value("note")).toBe("Con nota");
    expect(el.shadowRoot!.querySelectorAll("[data-test^=line-rate-]").length).toBe(2);
    expect(value("line-rate-0")).toBe("10.00");
    expect(sel("line-kind-0")).toBe("capital");
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
        note: "Con nota",
      },
      lines: [
        { rate: "10.00", base: "100.00", tax: "10.00", kind: "capital" },
        { rate: "21.00", base: "100.00", tax: "21.00", kind: "ordinary" },
      ],
    });
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
        const kind = el.shadowRoot!.querySelector<HTMLSelectElement>("[data-test=line-kind-0]")!;
        const shown = kind.getBoundingClientRect().width;
        kind.style.width = "max-content";
        const needed = kind.getBoundingClientRect().width;
        kind.style.width = "";
        expect(shown, `${locale} the VAT type is cut off`).toBeGreaterThanOrEqual(needed);
      } finally {
        await page.viewport(width, height);
      }
    },
  );
});
