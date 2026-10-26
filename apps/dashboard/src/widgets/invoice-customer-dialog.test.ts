import { afterEach, describe, expect, it, vi } from "vitest";
import { formatMoney } from "@waitron/shared";
import type { WtButton, WtDataTable, WtFormActions, WtInput } from "@waitron/ui";
import { formMessageOf } from "@waitron/ui/src/test-helpers.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { currentLocale, setLocale } from "../i18n/t.js";
import { en, es, type StringKey } from "../i18n/strings.js";
import type { DashboardApi, InvoiceCustomerSearchDto } from "../api/client.js";
import type { DownloadedFile } from "@waitron/dashboard-kit";
import { codeMessage } from "../i18n/codes.js";
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
  download: (taxId: string) => Promise<DownloadedFile> = async () => FILE,
) {
  const load = modules["./invoice-customer-dialog.ts"];
  expect(load, "invoice customer dialog exists").toBeTypeOf("function");
  await load!();
  const api = {
    findInvoiceCustomer: vi.fn(find),
    downloadInvoiceCustomerData: vi.fn(download),
  } as unknown as DashboardApi;
  const mounted = await mountWidget<InvoiceCustomerDialog>(
    "dashboard-invoice-customer-dialog",
    { api, open: true },
    theme,
  );
  await mounted.el.updateComplete;
  return {
    ...mounted,
    find: vi.mocked(api.findInvoiceCustomer),
    download: vi.mocked(api.downloadInvoiceCustomerData),
  };
}

const FILE: DownloadedFile = {
  blob: new Blob(["zip"], { type: "application/zip" }),
  fileName: "invoice-customer-12345678Z.zip",
};

function spyOnSaving() {
  const blobs: Blob[] = [];
  const create = vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
    blobs.push(blob as Blob);
    return "blob:invoice-customer";
  });
  const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  const links: HTMLAnchorElement[] = [];
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    links.push(this);
  });
  return { blobs, create, revoke, links };
}

function downloadButton(el: InvoiceCustomerDialog): WtButton | null {
  return el.shadowRoot!.querySelector<WtButton>("[data-test=download]");
}

async function pressDownload(el: InvoiceCustomerDialog): Promise<void> {
  downloadButton(el)!.click();
  await el.updateComplete;
}

const preparing = (el: InvoiceCustomerDialog) =>
  el.shadowRoot!.querySelector<HTMLElement>("[role=status][data-test=preparing]");
const refusal = (el: InvoiceCustomerDialog) =>
  el.shadowRoot!.querySelector<HTMLElement>("[role=alert][data-test=refusal]");
const refusalText = (el: InvoiceCustomerDialog) =>
  refusal(el)?.querySelector("[data-test=refusal-text]")?.textContent?.trim();

async function searched(el: InvoiceCustomerDialog): Promise<void> {
  await type(el, "es 12345678z");
  await press(el);
  await expect.poll(() => downloadButton(el)).not.toBeNull();
}

function pending<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

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

async function bottomText(el: InvoiceCustomerDialog): Promise<string | undefined> {
  return (await bottomLine(el))?.textContent?.trim();
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
  const mount = async (
    find: (taxId: string) => Promise<InvoiceCustomerSearchDto>,
    download?: (taxId: string) => Promise<DownloadedFile>,
  ) => {
    setLocale(locale);
    return mountDialog(find, undefined, download);
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

  it("downloads the answered tax number, not the field's text, and saves it under the server's name", async () => {
    const saving = spyOnSaving();
    const answer = pending<DownloadedFile>();
    const { el, download } = await mount(
      async () => THREE,
      () => answer.promise,
    );
    await searched(el);
    expect(preparing(el)).toBeNull();
    await pressDownload(el);
    expect(download).toHaveBeenCalledExactlyOnceWith("12345678Z");
    expect(downloadButton(el)!.disabled).toBe(true);
    expect(preparing(el)?.textContent?.trim()).toBe(words["invoice_customer.preparing"]);
    await pressDownload(el);
    expect(download).toHaveBeenCalledOnce();
    answer.resolve(FILE);
    await expect.poll(() => saving.links.length).toBe(1);
    expect(saving.links[0]!.download).toBe("invoice-customer-12345678Z.zip");
    expect(saving.links[0]!.href).toBe("blob:invoice-customer");
    expect(saving.blobs).toEqual([FILE.blob]);
    expect(saving.revoke).toHaveBeenCalledExactlyOnceWith("blob:invoice-customer");
    await el.updateComplete;
    expect(preparing(el)).toBeNull();
    expect(downloadButton(el)!.disabled).toBe(false);
    expect(refusal(el)).toBeNull();
  });

  it("saves under a fallback name when the server names no file", async () => {
    const saving = spyOnSaving();
    const { el } = await mount(
      async () => THREE,
      async () => ({ blob: FILE.blob, fileName: null }),
    );
    await searched(el);
    await pressDownload(el);
    await expect.poll(() => saving.links.length).toBe(1);
    expect(saving.links[0]!.download).toBe("invoice-customer-data.zip");
    expect(saving.revoke).toHaveBeenCalledOnce();
  });

  it("explains a lost permission and offers to sign in as an administrator, once, across the shadow root", async () => {
    spyOnSaving();
    const { el, download } = await mount(
      async () => THREE,
      () => Promise.reject({ code: "authorization.not_permitted" }),
    );
    const heard: Event[] = [];
    const listener = (event: Event) => heard.push(event);
    document.body.addEventListener("admin-sign-in", listener);
    try {
      await searched(el);
      await pressDownload(el);
      await expect.poll(() => refusalText(el)).toBe(words["invoice_customer.not_permitted"]);
      const signIn = refusal(el)!.querySelector<WtButton>("[data-test=admin-sign-in]")!;
      expect(signIn.textContent!.trim()).toBe(words["staff.sign_in_as_admin"]);
      expect(downloadButton(el)!.disabled).toBe(false);
      expect(findButton(el).disabled).toBe(false);
      signIn.click();
      expect(heard).toHaveLength(1);
      expect(heard[0]!.bubbles).toBe(true);
      expect(heard[0]!.composed).toBe(true);
      await pressDownload(el);
      expect(download).toHaveBeenCalledTimes(2);
    } finally {
      document.body.removeEventListener("admin-sign-in", listener);
    }
  });

  it("leaves space between a download's refusal sentence and the sign-in button", async () => {
    spyOnSaving();
    const { el } = await mount(
      async () => THREE,
      () => Promise.reject({ code: "authorization.not_permitted" }),
    );
    await searched(el);
    await pressDownload(el);
    await expect.poll(() => refusalText(el)).toBe(words["invoice_customer.not_permitted"]);
    const sentence = refusal(el)!
      .querySelector("[data-test=refusal-text]")!
      .getBoundingClientRect();
    const button = refusal(el)!.querySelector("[data-test=admin-sign-in]")!.getBoundingClientRect();
    const across = Math.max(button.left - sentence.right, sentence.left - button.right);
    const down = button.top - sentence.bottom;
    expect(Math.max(across, down)).toBeGreaterThan(0);
  });

  it("puts Find's permission refusal in the bottom message and offers the administrator sign-in above it", async () => {
    const { el, find } = await mount(() => Promise.reject({ code: "authorization.not_permitted" }));
    const heard: Event[] = [];
    const listener = (event: Event) => heard.push(event);
    document.body.addEventListener("admin-sign-in", listener);
    try {
      await type(el, "12345678Z");
      await press(el);
      await expect.poll(() => bottomText(el)).toBe(words["invoice_customer.not_permitted"]);
      expect(refusal(el)).toBeNull();
      expect(el.shadowRoot!.textContent).not.toContain(words["invoice_customer.not_permitted"]);
      const signIn = el.shadowRoot!.querySelector<WtButton>("[data-test=admin-sign-in]")!;
      expect(signIn.textContent!.trim()).toBe(words["staff.sign_in_as_admin"]);
      expect(signIn.closest("wt-form-actions")).toBeNull();
      expect(taxField(el).error).toBe("");
      expect(findButton(el).disabled).toBe(false);
      signIn.click();
      expect(heard).toHaveLength(1);
      expect(heard[0]!.bubbles).toBe(true);
      expect(heard[0]!.composed).toBe(true);
      await type(el, "12345678");
      expect(await bottomLine(el)).toBeNull();
      expect(el.shadowRoot!.querySelector("[data-test=admin-sign-in]")).toBeNull();
      expect(find).toHaveBeenCalledOnce();
    } finally {
      document.body.removeEventListener("admin-sign-in", listener);
    }
  });

  it("keeps Find's refusal in the bottom message until Find is pressed again", async () => {
    const second = pending<InvoiceCustomerSearchDto>();
    let calls = 0;
    const { el } = await mount(() =>
      ++calls === 1 ? Promise.reject({ code: "server.internal" }) : second.promise,
    );
    await type(el, "12345678Z");
    await press(el);
    await expect.poll(() => bottomText(el)).toBe(codeMessage("server.internal"));
    expect(refusal(el)).toBeNull();
    await press(el);
    expect(await bottomLine(el)).toBeNull();
    second.resolve(THREE);
    await expect.poll(async () => (await rows(el)).length).toBe(3);
    expect(await bottomLine(el)).toBeNull();
  });

  it.each([
    ["invoice_customer.not_found", "invoice_customer.vanished"],
    ["node.read_only", "invoice_customer.read_only"],
  ] as const)("shows a download's %s refusal and keeps Download pressable", async (code, key) => {
    const saving = spyOnSaving();
    let refuse = true;
    const { el, download } = await mount(
      async () => THREE,
      async () => {
        if (refuse) throw { code };
        return FILE;
      },
    );
    await searched(el);
    await pressDownload(el);
    await expect.poll(() => refusalText(el)).toBe(words[key]);
    expect(refusal(el)!.querySelector("[data-test=admin-sign-in]")).toBeNull();
    expect(downloadButton(el)!.disabled).toBe(false);
    refuse = false;
    await pressDownload(el);
    expect(refusal(el)).toBeNull();
    await expect.poll(() => saving.links.length).toBe(1);
    expect(download).toHaveBeenCalledTimes(2);
  });

  it("shows any other download refusal through the code's message", async () => {
    spyOnSaving();
    const { el } = await mount(
      async () => THREE,
      () => Promise.reject({ code: "server.internal" }),
    );
    await searched(el);
    await pressDownload(el);
    await expect.poll(() => refusalText(el)).toBe(codeMessage("server.internal"));
    expect(downloadButton(el)!.disabled).toBe(false);
  });

  it("shows Find's read-only refusal with the mirror's sentence and keeps Find pressable", async () => {
    const { el, find } = await mount(() => Promise.reject({ code: "node.read_only" }));
    await type(el, "12345678Z");
    await press(el);
    await expect.poll(() => bottomText(el)).toBe(words["invoice_customer.read_only"]);
    expect(refusal(el)).toBeNull();
    expect(findButton(el).disabled).toBe(false);
    expect(findButton(el).variant).toBe("primary");
    await press(el);
    expect(find).toHaveBeenCalledTimes(2);
  });

  it("shows Find's other refusals through the code's message", async () => {
    const { el } = await mount(() => Promise.reject({ code: "server.internal" }));
    await type(el, "12345678Z");
    await press(el);
    await expect.poll(() => bottomText(el)).toBe(codeMessage("server.internal"));
    expect(refusal(el)).toBeNull();
    expect(findButton(el).disabled).toBe(false);
  });

  it("drops a download's answer once the dialog has closed", async () => {
    const saving = spyOnSaving();
    const answer = pending<DownloadedFile>();
    const { el } = await mount(
      async () => THREE,
      () => answer.promise,
    );
    await searched(el);
    await pressDownload(el);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=close]")!.click();
    await expect.poll(() => el.open).toBe(false);
    answer.resolve(FILE);
    await tick();
    await el.updateComplete;
    expect(saving.links).toEqual([]);
    expect(saving.create).not.toHaveBeenCalled();
  });

  it("drops a download's answer once the field is edited", async () => {
    const saving = spyOnSaving();
    const answer = pending<DownloadedFile>();
    const { el } = await mount(
      async () => THREE,
      () => answer.promise,
    );
    await searched(el);
    await pressDownload(el);
    await type(el, "12345678");
    answer.resolve(FILE);
    await tick();
    await el.updateComplete;
    expect(saving.links).toEqual([]);
    expect(saving.create).not.toHaveBeenCalled();
  });

  it("drops a download's answer once a different number has been searched", async () => {
    const saving = spyOnSaving();
    const answer = pending<DownloadedFile>();
    const { el, find } = await mount(
      async () => THREE,
      () => answer.promise,
    );
    await searched(el);
    await pressDownload(el);
    await type(el, "87654321X");
    await press(el);
    expect(find).toHaveBeenLastCalledWith("87654321X");
    await expect.poll(() => downloadButton(el)).not.toBeNull();
    answer.resolve(FILE);
    await tick();
    await el.updateComplete;
    expect(saving.links).toEqual([]);
    expect(saving.create).not.toHaveBeenCalled();
    expect(preparing(el)).toBeNull();
    expect(downloadButton(el)!.disabled).toBe(false);
  });

  it("shows Find's not-found refusal through the code's message, not the download's fault sentence", async () => {
    const { el } = await mount(() => Promise.reject({ code: "invoice_customer.not_found" }));
    await type(el, "12345678Z");
    await press(el);
    await expect.poll(() => bottomText(el)).toBe(codeMessage("invoice_customer.not_found"));
    expect(await bottomText(el)).not.toBe(words["invoice_customer.vanished"]);
    expect(refusal(el)).toBeNull();
  });

  it("keeps Find quiet and disabled while a download is out, sends no search, and is primary again after", async () => {
    spyOnSaving();
    const answer = pending<DownloadedFile>();
    const { el, find } = await mount(
      async () => THREE,
      () => answer.promise,
    );
    await searched(el);
    expect(findButton(el).disabled).toBe(false);
    expect(findButton(el).variant).toBe("primary");
    await pressDownload(el);
    expect(findButton(el).disabled).toBe(true);
    expect(findButton(el).variant).toBe("secondary");
    await press(el);
    expect(find).toHaveBeenCalledOnce();
    expect(downloadButton(el)).not.toBeNull();
    expect(preparing(el)).not.toBeNull();
    answer.resolve(FILE);
    await expect.poll(() => findButton(el).variant).toBe("primary");
    expect(findButton(el).disabled).toBe(false);
  });

  it("forgets the first press when the dialog is closed and reopened", async () => {
    const { el } = await mount(async () => THREE);
    await type(el, "12/34");
    await press(el);
    expect(taxField(el).error).toBe(words["invoice_customer.tax_id_invalid"]);
    el.open = false;
    await el.updateComplete;
    el.open = true;
    await el.updateComplete;
    expect(taxField(el).value).toBe("");
    await type(el, "12/34");
    expect(taxField(el).error).toBe("");
    expect(await bottomLine(el)).toBeNull();
    expect(findButton(el).disabled).toBe(false);
  });
});
