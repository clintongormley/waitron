import { afterEach, describe, expect, it, vi } from "vitest";
import { formatMoney } from "@waitron/shared";
import type { WtButton, WtDataTable, WtFormActions, WtInput } from "@waitron/ui";
import { formMessageOf } from "@waitron/ui/src/test-helpers.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { currentLocale, setLocale } from "../i18n/t.js";
import { en, es, type StringKey } from "../i18n/strings.js";
import type { DashboardApi, InvoiceCustomerSearchDto } from "../api/client.js";
import type { InvoiceCustomerDialog } from "./invoice-customer-dialog.js";

const modules = import.meta.glob<typeof import("./invoice-customer-dialog.js")>(
  "./invoice-customer-dialog.ts",
);

afterEach(() => {
  cleanupWidgets();
  vi.restoreAllMocks();
  setLocale("en-GB");
});

// In neither date nor invoice-number order, so a re-sort of either kind changes the rows.
const THREE: InvoiceCustomerSearchDto = {
  taxId: "12345678Z",
  invoices: [
    {
      invoice: "F1-2026-0011",
      issuedAt: "2026-09-30T09:05:00.000Z",
      name: "Jordi Puig",
      total: "7.05",
    },
    {
      invoice: "F1-2026-0020",
      issuedAt: "2026-03-02T10:15:00.000Z",
      name: "Jordi Puig",
      total: "12.50",
    },
    {
      invoice: "F1-2026-0003",
      issuedAt: "2026-05-19T18:40:00.000Z",
      name: "Puig Electrical Ltd",
      total: "240.00",
    },
  ],
};

async function mountDialog(
  find: (taxId: string) => Promise<InvoiceCustomerSearchDto>,
  theme?: "light" | "dark",
) {
  const load = modules["./invoice-customer-dialog.ts"];
  expect(load, "invoice customer dialog exists").toBeTypeOf("function");
  await load!();
  const api = { findInvoiceCustomer: vi.fn(find) } as unknown as DashboardApi;
  const mounted = await mountWidget<InvoiceCustomerDialog>(
    "dashboard-invoice-customer-dialog",
    { api, open: true },
    theme,
  );
  await mounted.el.updateComplete;
  return { ...mounted, find: vi.mocked(api.findInvoiceCustomer) };
}

function taxField(el: InvoiceCustomerDialog): WtInput {
  return el.shadowRoot!.querySelector<WtInput>("wt-input[name=taxId]")!;
}

function findButton(el: InvoiceCustomerDialog): WtButton {
  return el.shadowRoot!.querySelector<WtButton>("[data-test=find]")!;
}

async function type(el: InvoiceCustomerDialog, value: string): Promise<void> {
  const field = taxField(el);
  await field.updateComplete;
  const input = field.shadowRoot!.querySelector("input")!;
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  await el.updateComplete;
}

async function press(el: InvoiceCustomerDialog): Promise<void> {
  findButton(el).click();
  await el.updateComplete;
}

async function bottomLine(el: InvoiceCustomerDialog): Promise<Element | null> {
  await el.updateComplete;
  return formMessageOf(el.shadowRoot!.querySelector<WtFormActions>("wt-form-actions")!);
}

async function rows(el: InvoiceCustomerDialog): Promise<string[][]> {
  const table = el.shadowRoot!.querySelector<WtDataTable<unknown>>("wt-data-table");
  if (!table) return [];
  await table.updateComplete;
  return [...table.shadowRoot!.querySelectorAll("tr[data-row-key]")].map((row) =>
    [...row.querySelectorAll("td")].map((cell) => cell.textContent!.trim()),
  );
}

describe.each([
  ["en-GB", en],
  ["es-ES", es],
] as const)("in %s", (locale, words: Readonly<Record<StringKey, string>>) => {
  const mount = async (find: (taxId: string) => Promise<InvoiceCustomerSearchDto>) => {
    setLocale(locale);
    return mountDialog(find);
  };

  it("keeps Find quiet and disabled while the field is empty, and primary once it has text", async () => {
    const { el } = await mount(async () => THREE);
    expect(findButton(el).disabled).toBe(true);
    expect(findButton(el).variant).toBe("secondary");
    expect(findButton(el).textContent!.trim()).toBe(words["invoice_customer.find"]);
    expect(taxField(el).label).toBe(words["invoice_customer.tax_id"]);
    expect(taxField(el).hint).toBe(words["invoice_customer.tax_id_hint"]);
    expect(taxField(el).required).toBe(true);
    await type(el, "12345678Z");
    expect(findButton(el).disabled).toBe(false);
    expect(findButton(el).variant).toBe("primary");
  });

  it.each(["ES", "es", " "])(
    "says nothing and keeps Find quiet while the field holds only %j",
    async (typed) => {
      const { el } = await mount(async () => THREE);
      await type(el, typed);
      expect(taxField(el).error).toBe("");
      expect(await bottomLine(el)).toBeNull();
      expect(findButton(el).disabled).toBe(true);
      expect(findButton(el).variant).toBe("secondary");
    },
  );

  it("marks an invalid value only once Find is pressed, sends nothing, and clears the mark once fixed", async () => {
    const { el, find } = await mount(async () => THREE);
    await type(el, "12/34");
    expect(taxField(el).error).toBe("");
    expect(await bottomLine(el)).toBeNull();
    expect(findButton(el).disabled).toBe(false);
    expect(findButton(el).variant).toBe("primary");
    await press(el);
    expect(taxField(el).error).toBe(words["invoice_customer.tax_id_invalid"]);
    expect((await bottomLine(el))?.textContent?.trim()).toBe(words["form.fix_fields"]);
    expect(find).not.toHaveBeenCalled();
    await expect.poll(() => taxField(el).shadowRoot!.activeElement?.tagName).toBe("INPUT");
    expect(findButton(el).disabled).toBe(true);
    expect(findButton(el).variant).toBe("secondary");
    await type(el, "12345678Z");
    expect(taxField(el).error).toBe("");
    expect(await bottomLine(el)).toBeNull();
    expect(findButton(el).disabled).toBe(false);
    expect(findButton(el).variant).toBe("primary");
    await type(el, "1234/");
    expect(taxField(el).error).toBe(words["invoice_customer.tax_id_invalid"]);
    expect(findButton(el).disabled).toBe(true);
  });

  it("sends the typed text once when Find is pressed", async () => {
    const { el, find } = await mount(async () => ({ taxId: "12345678Z", invoices: [] }));
    await type(el, "es 12345678z");
    await press(el);
    expect(find).toHaveBeenCalledExactlyOnceWith("es 12345678z");
  });

  it("says nothing names the number when no invoice matches, and offers no download", async () => {
    const { el } = await mount(async () => ({ taxId: "12345678Z", invoices: [] }));
    await type(el, "12345678Z");
    await press(el);
    await expect
      .poll(() =>
        el.shadowRoot!.querySelector("[role=status][data-test=none]")?.textContent?.trim(),
      )
      .toBe(words["invoice_customer.none"]);
    expect(el.shadowRoot!.querySelector("[data-test=download]")).toBeNull();
    expect(el.shadowRoot!.querySelector("wt-data-table")).toBeNull();
  });

  it("counts and lists three invoices in the answer's order and offers their data", async () => {
    const { el } = await mount(async () => THREE);
    await type(el, "12345678Z");
    await press(el);
    await expect
      .poll(() => el.shadowRoot!.querySelector("[data-test=count]")?.textContent?.trim())
      .toBe(words["invoice_customer.count"].replace("{count}", "3"));
    const day = new Intl.DateTimeFormat(currentLocale(), { dateStyle: "medium" });
    expect(await rows(el)).toEqual(
      THREE.invoices.map((row) => [
        row.invoice,
        day.format(new Date(row.issuedAt)),
        row.name,
        formatMoney(row.total, currentLocale()),
      ]),
    );
    const download = el.shadowRoot!.querySelector<WtButton>("[data-test=download]");
    expect(download?.textContent?.trim()).toBe(words["person.download_data"]);
    expect(download?.variant).toBe("primary");
  });

  it("counts one invoice with the singular words", async () => {
    const { el } = await mount(async () => ({ ...THREE, invoices: THREE.invoices.slice(0, 1) }));
    await type(el, "12345678Z");
    await press(el);
    await expect
      .poll(() => el.shadowRoot!.querySelector("[data-test=count]")?.textContent?.trim())
      .toBe(words["invoice_customer.count_one"]);
  });

  it("clears the list and the download once the field is edited after a search", async () => {
    const { el } = await mount(async () => THREE);
    await type(el, "12345678Z");
    await press(el);
    await expect.poll(async () => (await rows(el)).length).toBe(3);
    await type(el, "12345678");
    expect(el.shadowRoot!.querySelector("wt-data-table")).toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test=count]")).toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test=download]")).toBeNull();
  });

  it("drops an answer that arrives after the field was edited", async () => {
    let answer!: (value: InvoiceCustomerSearchDto) => void;
    const { el } = await mount(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    await type(el, "12345678Z");
    await press(el);
    await type(el, "12345678");
    answer(THREE);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("wt-data-table")).toBeNull();
  });

  it("shows the server's refusal of the tax number under the field", async () => {
    const { el } = await mount(() =>
      Promise.reject({ code: "management.request_invalid", params: { field: "taxId" } }),
    );
    await type(el, "12345678Z");
    await press(el);
    await expect.poll(() => taxField(el).error).toBe(words["invoice_customer.tax_id_invalid"]);
    expect((await bottomLine(el))?.textContent?.trim()).toBe(words["form.fix_fields"]);
    expect(findButton(el).disabled).toBe(false);
  });
});
