import { afterEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { chooseOption, formMessageOf } from "@waitron/ui/src/test-helpers.js";
import type { WtFormActions } from "@waitron/ui";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { codeMessage } from "../i18n/codes.js";
import { fill, t } from "../i18n/t.js";
import type { PagePrinterRow, PageTestPage } from "../api/client.js";
import type { PagePrintersPanel } from "./page-printers-panel.js";
import "./page-printers-panel.js";

afterEach(cleanupWidgets);

const row = (over: Partial<PagePrinterRow> = {}): PagePrinterRow => ({
  id: "pp1",
  name: "Office",
  host: "10.0.0.56",
  port: 631,
  resourcePath: "/ipp/print",
  documentFormat: "application/pdf",
  supportedFormats: ["application/pdf"],
  media: "iso_a4_210x297mm",
  resolutionDpi: 300,
  active: true,
  invoicePrinter: true,
  agentId: "a1",
  agentName: "Cocina agent",
  ...over,
});
const ROWS = [
  row(),
  row({ id: "pp2", name: "Back office", host: "10.0.0.57", invoicePrinter: false }),
  row({
    id: "pp3",
    name: "Old laser",
    host: "10.0.0.58",
    active: false,
    invoicePrinter: false,
    agentId: null,
    agentName: null,
    media: "na_letter_8.5x11in",
  }),
];

function stubApi() {
  const background = {
    readPagePrinterTestPage: vi.fn<(id: string) => Promise<PageTestPage | null>>(),
  };
  return {
    updatePagePrinter: vi.fn().mockResolvedValue(undefined),
    setInvoicePrinter: vi.fn().mockResolvedValue(undefined),
    printPagePrinterTestPage: vi
      .fn<(id: string) => Promise<PageTestPage>>()
      .mockResolvedValue({ id: "tp1", status: "waiting" }),
    readPagePrinterTestPage: vi.fn<(id: string) => Promise<PageTestPage | null>>(),
    background,
  };
}

async function mount(over: Partial<PagePrintersPanel> = {}) {
  const api = stubApi();
  const reload = vi.fn().mockResolvedValue(undefined);
  const { el } = await mountWidget<PagePrintersPanel>("dashboard-page-printers-panel", {
    api,
    rows: ROWS,
    canManage: true,
    reload,
    testPagePollMs: 1,
    ...over,
  } as Partial<PagePrintersPanel>);
  await flush(el);
  return { el, api, reload };
}

async function settleTree(root: ShadowRoot | HTMLElement): Promise<void> {
  for (const node of root.querySelectorAll<HTMLElement>("*")) {
    if ("updateComplete" in node)
      await (node as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete;
    if (node.shadowRoot) await settleTree(node.shadowRoot);
  }
}
async function flush(el: PagePrintersPanel): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
  await settleTree(el.shadowRoot!);
  await el.updateComplete;
}
function deepQuery(root: ShadowRoot | HTMLElement, sel: string): HTMLElement | null {
  const found = root.querySelector<HTMLElement>(sel);
  if (found) return found;
  for (const node of root.querySelectorAll<HTMLElement>("*")) {
    if (node.shadowRoot) {
      const nested = deepQuery(node.shadowRoot, sel);
      if (nested) return nested;
    }
  }
  return null;
}
const q = (el: PagePrintersPanel, sel: string) => deepQuery(el.shadowRoot!, sel);
const text = (el: PagePrintersPanel, sel: string) =>
  q(el, sel)?.textContent?.replace(/\s+/g, " ").trim();
const button = (el: PagePrintersPanel, sel: string) =>
  q(el, sel) as unknown as HTMLElementTagNameMap["wt-button"];
const choice = (el: PagePrintersPanel) =>
  q(el, "[data-test=invoice-printer-choice]") as unknown as HTMLElementTagNameMap["wt-combobox"];
async function click(el: PagePrintersPanel, sel: string) {
  q(el, sel)!.click();
  await flush(el);
}
async function typeName(el: PagePrintersPanel, value: string) {
  const field = q(
    el,
    "[data-test=rename-page-printer-modal] wt-input[name=name]",
  ) as unknown as HTMLElementTagNameMap["wt-input"];
  await userEvent.fill(page.elementLocator(field.shadowRoot!.querySelector("input")!), value);
  await flush(el);
}
const choiceMessage = async (el: PagePrintersPanel) =>
  (
    await formMessageOf(q(el, "[data-test=invoice-printer-actions]") as unknown as WtFormActions)
  )?.textContent?.trim() ?? "";

it("lists each office printer under the invoice printers heading, with its agent, address and paper", async () => {
  const { el } = await mount();
  expect(text(el, "h2")).toBe(t("printers.invoice_printers_title"));
  // The heading names the kind; no row repeats it.
  const cells = q(el, "[data-test=page-printers-table]")!.shadowRoot!.textContent!;
  for (const marker of ["Invoice printer (A4)", "Impresora de facturas (A4)"])
    expect(cells).not.toContain(marker);
  expect(q(el, "[data-test^=page-printer-kind-]")).toBeNull();
  expect(text(el, "[data-test=page-printer-name-pp1]")).toContain("Office");
  expect(text(el, "[data-test=page-printer-chosen-pp1]")).toBe(
    t("printers.invoice_printer_chosen"),
  );
  expect(q(el, "[data-test=page-printer-chosen-pp2]")).toBeNull();
  expect(text(el, "[data-test=page-printer-agent-pp1]")).toBe("Cocina agent");
  expect(text(el, "[data-test=page-printer-agent-pp3]")).toBe(
    t("printers.invoice_printer_agent_gone"),
  );
  expect(text(el, "[data-test=page-printer-address-pp2]")).toBe("10.0.0.57:631");
  expect(text(el, "[data-test=page-printer-paper-pp1]")).toBe(t("printers.invoice_printer_a4"));
  expect(text(el, "[data-test=page-printer-paper-pp3]")).toBe(t("printers.invoice_printer_letter"));
});

it("says a disabled printer is enabled by finding it again, and offers no Enable", async () => {
  const { el } = await mount();
  expect(text(el, "[data-test=page-printer-status-pp2]")).toBe(t("printers.status_active"));
  expect(text(el, "[data-test=page-printer-status-pp3]")).toContain(t("printers.status_disabled"));
  expect(text(el, "[data-test=page-printer-rediscover-pp3]")).toBe(
    t("printers.invoice_printer_rediscover"),
  );
  expect(q(el, "[data-test=page-printer-rediscover-pp2]")).toBeNull();
  const disable = button(el, "[data-test=disable-page-printer-pp3]");
  expect(disable.disabled).toBe(true);
  expect(disable.variant).toBe("secondary");
  expect(button(el, "[data-test=disable-page-printer-pp2]").variant).toBe("danger");
  expect(q(el, "[data-test=enable-page-printer-pp3]")).toBeNull();
});

it("keeps the row menu in a pinned actions column", async () => {
  const { el } = await mount();
  const table = q(el, "[data-test=page-printers-table]") as unknown as {
    columns: { key: string; pinned?: string }[];
  };
  expect(table.columns.at(-1)).toMatchObject({ key: "actions", pinned: "end" });
});

it("draws nothing while the location has no office printer", async () => {
  const { el } = await mount({ rows: [] });
  expect(q(el, "[data-test=page-printers-panel]")).toBeNull();
});

it("renames a printer in a dialog whose Save waits for a change, then reads the list again", async () => {
  const { el, api, reload } = await mount();
  await click(el, "[data-test=rename-page-printer-pp2]");
  const field = q(
    el,
    "[data-test=rename-page-printer-modal] wt-input[name=name]",
  ) as unknown as HTMLElementTagNameMap["wt-input"];
  expect(field.required).toBe(true);
  expect(field.value).toBe("Back office");
  const save = button(el, "[data-test=confirm-rename-page-printer]");
  expect(save.disabled).toBe(true);
  expect(save.variant).toBe("secondary");
  await typeName(el, "  Upstairs ");
  expect(save.disabled).toBe(false);
  expect(save.variant).toBe("primary");
  await click(el, "[data-test=confirm-rename-page-printer]");
  expect(api.updatePagePrinter).toHaveBeenCalledWith("pp2", { name: "Upstairs" });
  await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
  await vi.waitFor(() =>
    expect(
      (q(el, "[data-test=rename-page-printer-modal]") as unknown as { open: boolean }).open,
    ).toBe(false),
  );
});

it("a press that reaches an untouched rename Save's handler sends nothing and marks nothing", async () => {
  const { el, api } = await mount();
  await click(el, "[data-test=rename-page-printer-pp2]");
  await click(el, "[data-test=confirm-rename-page-printer]");
  expect(api.updatePagePrinter).not.toHaveBeenCalled();
  const field = q(
    el,
    "[data-test=rename-page-printer-modal] wt-input[name=name]",
  ) as unknown as HTMLElementTagNameMap["wt-input"];
  expect(field.invalid).toBe(false);
});

it("explains an empty name beside the field and at the bottom, and sends nothing", async () => {
  const { el, api } = await mount();
  await click(el, "[data-test=rename-page-printer-pp2]");
  await typeName(el, "   ");
  await click(el, "[data-test=confirm-rename-page-printer]");
  expect(api.updatePagePrinter).not.toHaveBeenCalled();
  const field = q(
    el,
    "[data-test=rename-page-printer-modal] wt-input[name=name]",
  ) as unknown as HTMLElementTagNameMap["wt-input"];
  expect(field.error).toBe(t("form.name_required"));
  const actions = q(el, "[data-test=rename-page-printer-actions]") as unknown as WtFormActions;
  expect((await formMessageOf(actions))?.textContent?.trim()).toBe(t("form.fix_fields"));
  expect(button(el, "[data-test=confirm-rename-page-printer]").disabled).toBe(true);
});

it("keeps a refused rename open with the refusal at the bottom and Save still usable", async () => {
  const { el, api, reload } = await mount();
  api.updatePagePrinter.mockRejectedValueOnce({ code: "page_printer.not_found" });
  await click(el, "[data-test=rename-page-printer-pp2]");
  await typeName(el, "Upstairs");
  await click(el, "[data-test=confirm-rename-page-printer]");
  await flush(el);
  const actions = q(el, "[data-test=rename-page-printer-actions]") as unknown as WtFormActions;
  expect((await formMessageOf(actions))?.textContent?.trim()).toBe(
    codeMessage("page_printer.not_found"),
  );
  expect(
    (q(el, "[data-test=rename-page-printer-modal]") as unknown as { open: boolean }).open,
  ).toBe(true);
  expect(button(el, "[data-test=confirm-rename-page-printer]").disabled).toBe(false);
  expect(reload).not.toHaveBeenCalled();
});

it("puts a refusal that names the name field under it, until the name changes", async () => {
  const { el, api } = await mount();
  api.updatePagePrinter.mockRejectedValueOnce({
    code: "management.request_invalid",
    params: { field: "name" },
  });
  await click(el, "[data-test=rename-page-printer-pp2]");
  await typeName(el, "Upstairs");
  await click(el, "[data-test=confirm-rename-page-printer]");
  await flush(el);
  const field = q(
    el,
    "[data-test=rename-page-printer-modal] wt-input[name=name]",
  ) as unknown as HTMLElementTagNameMap["wt-input"];
  expect(field.error).toBe(codeMessage("management.request_invalid"));
  const actions = q(el, "[data-test=rename-page-printer-actions]") as unknown as WtFormActions;
  expect((await formMessageOf(actions))?.textContent?.trim()).toBe(t("form.fix_fields"));
  await typeName(el, "Upstairs 2");
  expect(field.error).toBe("");
});

it("saves a rename on Enter", async () => {
  const { el, api } = await mount();
  await click(el, "[data-test=rename-page-printer-pp2]");
  await typeName(el, "Upstairs");
  await userEvent.keyboard("{Enter}");
  await vi.waitFor(() =>
    expect(api.updatePagePrinter).toHaveBeenCalledWith("pp2", { name: "Upstairs" }),
  );
});

it("sends one disable however often the row's Disable is pressed while it is out", async () => {
  const { el, api } = await mount();
  let finish!: () => void;
  api.updatePagePrinter.mockReturnValueOnce(new Promise<void>((resolve) => (finish = resolve)));
  await click(el, "[data-test=disable-page-printer-pp2]");
  expect(button(el, "[data-test=disable-page-printer-pp2]").loading).toBe(true);
  await click(el, "[data-test=disable-page-printer-pp2]");
  expect(api.updatePagePrinter).toHaveBeenCalledTimes(1);
  finish();
  await flush(el);
  expect(button(el, "[data-test=disable-page-printer-pp2]").loading).toBe(false);
});

it("disables the chosen printer, says no invoice printer is set now, and reads the list again", async () => {
  const { el, api, reload } = await mount();
  await click(el, "[data-test=disable-page-printer-pp1]");
  expect(api.updatePagePrinter).toHaveBeenCalledWith("pp1", { active: false });
  await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
  await flush(el);
  expect(text(el, "[data-test=invoice-printer-cleared]")).toBe(
    t("printers.invoice_printer_cleared").replace("{name}", "Office"),
  );
});

it("disabling a printer that was not chosen says nothing about the choice", async () => {
  const { el, api } = await mount();
  await click(el, "[data-test=disable-page-printer-pp2]");
  expect(api.updatePagePrinter).toHaveBeenCalledWith("pp2", { active: false });
  await flush(el);
  expect(q(el, "[data-test=invoice-printer-cleared]")).toBeNull();
});

it("shows a refused disable as the panel's alert and keeps the row's Disable usable", async () => {
  const { el, api, reload } = await mount();
  api.updatePagePrinter.mockRejectedValueOnce({ code: "connection.failed" });
  await click(el, "[data-test=disable-page-printer-pp2]");
  await flush(el);
  expect(text(el, "[data-test=page-printers-action-error]")).toBe(codeMessage("connection.failed"));
  expect(q(el, "[data-test=page-printers-read-error]")).toBeNull();
  expect(q(el, "[data-test=invoice-printer-cleared]")).toBeNull();
  expect(button(el, "[data-test=disable-page-printer-pp2]").disabled).toBe(false);
  expect(reload).not.toHaveBeenCalled();
});

it("a role without printer.manage sees the list with no row menu, no rename and no choice", async () => {
  const { el } = await mount({ canManage: false });
  expect(text(el, "[data-test=page-printer-chosen-pp1]")).toBe(
    t("printers.invoice_printer_chosen"),
  );
  const table = q(el, "[data-test=page-printers-table]") as unknown as {
    columns: { key: string }[];
  };
  expect(table.columns.map(({ key }) => key)).not.toContain("actions");
  expect(q(el, "dashboard-row-actions")).toBeNull();
  expect(q(el, "[data-test=invoice-printer-choice]")).toBeNull();
  expect(q(el, "[data-test=save-invoice-printer]")).toBeNull();
});

it("offers the active printers and None, starting on the location's choice with Save quiet", async () => {
  const { el } = await mount();
  const box = choice(el);
  expect(box.getAttribute("name")).toBe("invoicePrinterId");
  expect(box.value).toBe("pp1");
  expect(box.options.map(({ value, label }) => [value, label])).toEqual([
    ["", t("printers.invoice_printer_none")],
    ["pp1", "Office"],
    ["pp2", "Back office"],
  ]);
  const save = button(el, "[data-test=save-invoice-printer]");
  expect(save.disabled).toBe(true);
  expect(save.variant).toBe("secondary");
});

it("saves another choice, then None, each time reading the list again", async () => {
  const { el, api, reload } = await mount();
  await chooseOption(choice(el), "pp2");
  await flush(el);
  const save = button(el, "[data-test=save-invoice-printer]");
  expect(save.disabled).toBe(false);
  expect(save.variant).toBe("primary");
  await click(el, "[data-test=save-invoice-printer]");
  expect(api.setInvoicePrinter).toHaveBeenCalledWith("pp2");
  await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
  await flush(el);
  expect(save.disabled).toBe(true);
  await chooseOption(choice(el), "");
  await flush(el);
  await click(el, "[data-test=save-invoice-printer]");
  expect(api.setInvoicePrinter).toHaveBeenLastCalledWith(null);
});

it("a press that reaches an unchanged Save's handler sends nothing", async () => {
  const { el, api } = await mount();
  await click(el, "[data-test=save-invoice-printer]");
  expect(api.setInvoicePrinter).not.toHaveBeenCalled();
});

it("a refused save keeps the staged choice, says why at the bottom, and leaves Save usable", async () => {
  const { el, api, reload } = await mount();
  api.setInvoicePrinter.mockRejectedValueOnce({ code: "page_printer.not_found" });
  await chooseOption(choice(el), "pp2");
  await flush(el);
  await click(el, "[data-test=save-invoice-printer]");
  await flush(el);
  expect(choice(el).value).toBe("pp2");
  expect(await choiceMessage(el)).toBe(codeMessage("page_printer.not_found"));
  expect(button(el, "[data-test=save-invoice-printer]").disabled).toBe(false);
  expect(reload).not.toHaveBeenCalled();
  expect(q(el, "[data-test=page-printers-read-error]")).toBeNull();
});

it("a saved choice whose re-read fails shows a load failure, not a failed save", async () => {
  const { el, reload } = await mount();
  reload.mockRejectedValueOnce({ code: "connection.failed" });
  await chooseOption(choice(el), "pp2");
  await flush(el);
  await click(el, "[data-test=save-invoice-printer]");
  await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
  await flush(el);
  expect(text(el, "[data-test=page-printers-read-error]")).toBe(
    `${t("printers.refresh_failed")} ${codeMessage("connection.failed")}`,
  );
  expect(await choiceMessage(el)).toBe("");
  expect(q(el, "[data-test=page-printers-action-error]")).toBeNull();
  const save = button(el, "[data-test=save-invoice-printer]");
  expect(save.disabled).toBe(true);
  expect(save.variant).toBe("secondary");
  expect(choice(el).value).toBe("pp2");
});

it("a rename whose re-read fails closes the dialog and shows a load failure", async () => {
  const { el, reload } = await mount();
  reload.mockRejectedValueOnce({ code: "connection.failed" });
  await click(el, "[data-test=rename-page-printer-pp2]");
  await typeName(el, "Upstairs");
  await click(el, "[data-test=confirm-rename-page-printer]");
  await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
  await flush(el);
  expect(text(el, "[data-test=page-printers-read-error]")).toBe(
    `${t("printers.refresh_failed")} ${codeMessage("connection.failed")}`,
  );
  expect(
    (q(el, "[data-test=rename-page-printer-modal]") as unknown as { open: boolean }).open,
  ).toBe(false);
});

it("a later list clears the load failure", async () => {
  const { el, reload } = await mount();
  reload.mockRejectedValueOnce({ code: "connection.failed" });
  await click(el, "[data-test=disable-page-printer-pp2]");
  await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
  await flush(el);
  expect(q(el, "[data-test=page-printers-read-error]")).not.toBeNull();
  el.rows = [ROWS[0]!, { ...ROWS[1]!, active: false }, ROWS[2]!];
  await flush(el);
  expect(q(el, "[data-test=page-printers-read-error]")).toBeNull();
});

it("follows a new list while the choice is untouched, and keeps a staged choice while it is offered", async () => {
  const { el } = await mount();
  el.rows = [
    { ...ROWS[0]!, invoicePrinter: false },
    { ...ROWS[1]!, invoicePrinter: true },
    ROWS[2]!,
  ];
  await flush(el);
  expect(choice(el).value).toBe("pp2");
  expect(button(el, "[data-test=save-invoice-printer]").disabled).toBe(true);
  await chooseOption(choice(el), "");
  await flush(el);
  el.rows = [{ ...ROWS[0]!, invoicePrinter: true }, ROWS[1]!, ROWS[2]!];
  await flush(el);
  expect(choice(el).value).toBe("");
  expect(button(el, "[data-test=save-invoice-printer]").disabled).toBe(false);
});

it("drops a staged choice whose printer is no longer active", async () => {
  const { el } = await mount();
  await chooseOption(choice(el), "pp2");
  await flush(el);
  el.rows = [ROWS[0]!, { ...ROWS[1]!, active: false }, ROWS[2]!];
  await flush(el);
  expect(choice(el).value).toBe("pp1");
  expect(button(el, "[data-test=save-invoice-printer]").disabled).toBe(true);
});

it("drops the no-printer note once a new list shows a printer chosen for the invoices", async () => {
  const { el } = await mount();
  await click(el, "[data-test=disable-page-printer-pp1]");
  await vi.waitFor(() => expect(q(el, "[data-test=invoice-printer-cleared]")).not.toBeNull());
  el.rows = [{ ...ROWS[0]!, active: false, invoicePrinter: false }, ROWS[1]!, ROWS[2]!];
  await flush(el);
  expect(q(el, "[data-test=invoice-printer-cleared]")).not.toBeNull();
  el.rows = [
    { ...ROWS[0]!, active: false, invoicePrinter: false },
    { ...ROWS[1]!, invoicePrinter: true },
    ROWS[2]!,
  ];
  await flush(el);
  expect(q(el, "[data-test=invoice-printer-cleared]")).toBeNull();
});

it.each([
  ["a saved choice", "choice"],
  ["a sent rename", "rename"],
] as const)("%s replaces a refused disable's message", async (_label, action) => {
  const { el, api } = await mount();
  api.updatePagePrinter.mockRejectedValueOnce({ code: "connection.failed" });
  await click(el, "[data-test=disable-page-printer-pp2]");
  await flush(el);
  expect(q(el, "[data-test=page-printers-action-error]")).not.toBeNull();
  if (action === "choice") {
    await chooseOption(choice(el), "pp2");
    await flush(el);
    await click(el, "[data-test=save-invoice-printer]");
  } else {
    await click(el, "[data-test=rename-page-printer-pp2]");
    await typeName(el, "Upstairs");
    await click(el, "[data-test=confirm-rename-page-printer]");
  }
  await flush(el);
  expect(q(el, "[data-test=page-printers-action-error]")).toBeNull();
});

it("keeps a refused disable's message through a new list, which is a read", async () => {
  const { el, api } = await mount();
  api.updatePagePrinter.mockRejectedValueOnce({ code: "connection.failed" });
  await click(el, "[data-test=disable-page-printer-pp2]");
  await flush(el);
  el.rows = [...ROWS];
  await flush(el);
  expect(text(el, "[data-test=page-printers-action-error]")).toBe(codeMessage("connection.failed"));
});

const testPageNote = (el: PagePrintersPanel, id = "pp2") =>
  text(el, `[data-test=page-printer-test-page-${id}]`);

it("prints a test page on an active row, then follows its outcome with passive reads until it is printed", async () => {
  const { el, api } = await mount();
  api.background.readPagePrinterTestPage
    .mockResolvedValueOnce({ id: "tp1", status: "printing" })
    .mockResolvedValue({ id: "tp1", status: "sent" });
  expect(button(el, "[data-test=print-test-page-pp2]").textContent?.trim()).toBe(
    t("printers.print_test_page"),
  );

  await click(el, "[data-test=print-test-page-pp2]");

  expect(api.printPagePrinterTestPage).toHaveBeenCalledWith("pp2");
  await vi.waitFor(() => expect(testPageNote(el)).toBe(t("printers.test_page_printed")));
  expect(api.background.readPagePrinterTestPage).toHaveBeenCalledWith("pp2");
  expect(api.readPagePrinterTestPage).not.toHaveBeenCalled();
  const reads = api.background.readPagePrinterTestPage.mock.calls.length;
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(api.background.readPagePrinterTestPage).toHaveBeenCalledTimes(reads);
  expect(q(el, "[data-test=page-printer-test-page-pp1]")).toBeNull();
});

it("shows the waiting and printing states on the row while the page is out", async () => {
  const { el, api } = await mount({ testPagePollMs: 60_000 } as Partial<PagePrintersPanel>);
  await click(el, "[data-test=print-test-page-pp2]");
  expect(testPageNote(el)).toBe(t("printers.test_page_waiting"));
  expect(q(el, "[data-test=page-printer-test-page-pp2]")!.getAttribute("role")).toBe("status");
  api.printPagePrinterTestPage.mockResolvedValueOnce({ id: "tp2", status: "printing" });
  await click(el, "[data-test=print-test-page-pp1]");
  expect(testPageNote(el, "pp1")).toBe(t("printers.test_page_printing"));
});

it("keeps the button quiet while its request or its page is out, and sends one request", async () => {
  const { el, api } = await mount();
  let answer!: (page: PageTestPage) => void;
  api.printPagePrinterTestPage.mockReturnValueOnce(
    new Promise<PageTestPage>((resolve) => {
      answer = resolve;
    }),
  );
  let printed!: (page: PageTestPage) => void;
  api.background.readPagePrinterTestPage.mockReturnValueOnce(
    new Promise<PageTestPage>((resolve) => {
      printed = resolve;
    }),
  );

  await click(el, "[data-test=print-test-page-pp2]");
  const action = button(el, "[data-test=print-test-page-pp2]");
  expect(action.disabled).toBe(true);
  expect(action.loading).toBe(true);
  await click(el, "[data-test=print-test-page-pp2]");
  answer({ id: "tp1", status: "waiting" });
  await flush(el);
  expect(action.loading).toBe(false);
  expect(action.disabled).toBe(true);
  await click(el, "[data-test=print-test-page-pp2]");
  expect(api.printPagePrinterTestPage).toHaveBeenCalledTimes(1);
  expect(button(el, "[data-test=print-test-page-pp1]").disabled).toBe(false);

  await vi.waitFor(() => expect(api.background.readPagePrinterTestPage).toHaveBeenCalled());
  printed({ id: "tp1", status: "sent" });
  await vi.waitFor(() => expect(action.disabled).toBe(false));
});

it.each([
  ["failed", "printer_refused", "printers.test_page_failed", "printers.test_page_reason_refused"],
  [
    "failed",
    "printer_unreachable",
    "printers.test_page_failed",
    "printers.test_page_reason_unreachable",
  ],
  [
    "failed",
    "document_unavailable",
    "printers.test_page_failed",
    "printers.test_page_reason_document",
  ],
  ["failed", "printer_disabled", "printers.test_page_failed", "printers.test_page_reason_disabled"],
  ["failed", "not_claimed", "printers.test_page_failed", "printers.test_page_reason_not_claimed"],
  ["unknown", "printer_aborted", "printers.test_page_unknown", "printers.test_page_reason_aborted"],
  ["unknown", "timeout", "printers.test_page_unknown", "printers.test_page_reason_timeout"],
] as const)(
  "shows a %s page (%s) on its row with the reason, and offers the button again",
  async (status, failureCode, sentence, reason) => {
    const { el, api } = await mount();
    api.background.readPagePrinterTestPage.mockResolvedValue({ id: "tp1", status, failureCode });
    await click(el, "[data-test=print-test-page-pp2]");
    await vi.waitFor(() => expect(testPageNote(el)).toBe(fill(sentence, { reason: t(reason) })));
    expect(button(el, "[data-test=print-test-page-pp2]").disabled).toBe(false);
  },
);

const HOLDS = [
  ["paper_out", "printers.test_page_hold_paper_out"],
  ["paper_jam", "printers.test_page_hold_paper_jam"],
  ["cover_open", "printers.test_page_hold_cover_open"],
  ["tray_missing", "printers.test_page_hold_tray_missing"],
  ["ink_or_toner_out", "printers.test_page_hold_ink_or_toner_out"],
  ["output_full", "printers.test_page_hold_output_full"],
  ["paused", "printers.test_page_hold_paused"],
  ["stopped", "printers.test_page_hold_stopped"],
] as const;

it.each(HOLDS)(
  "says what the printer is holding a printing page for (%s), keeps the button quiet and keeps reading",
  async (hold, reason) => {
    const { el, api } = await mount();
    api.background.readPagePrinterTestPage.mockResolvedValue({
      id: "tp1",
      status: "printing",
      hold,
    });
    await click(el, "[data-test=print-test-page-pp2]");
    await vi.waitFor(() =>
      expect(testPageNote(el)).toBe(fill("printers.test_page_held", { reason: t(reason) })),
    );
    expect(button(el, "[data-test=print-test-page-pp2]").disabled).toBe(true);
    const reads = api.background.readPagePrinterTestPage.mock.calls.length;
    await vi.waitFor(() =>
      expect(api.background.readPagePrinterTestPage.mock.calls.length).toBeGreaterThan(reads),
    );
  },
);

it.each(["fuser_hot", "toString"])(
  "says the page is waiting at the printer, with no reason, for a hold code it does not know (%s)",
  async (hold) => {
    const { el, api } = await mount();
    api.background.readPagePrinterTestPage.mockResolvedValue({
      id: "tp1",
      status: "printing",
      hold: hold as unknown as PageTestPage["hold"],
    });
    await click(el, "[data-test=print-test-page-pp2]");
    await vi.waitFor(() => expect(testPageNote(el)).toBe(t("printers.test_page_held_no_reason")));
    expect(button(el, "[data-test=print-test-page-pp2]").disabled).toBe(true);
  },
);

it("goes back to printing when the printer lets the page go", async () => {
  const { el, api } = await mount();
  const answers: ((page: PageTestPage) => void)[] = [];
  api.background.readPagePrinterTestPage.mockImplementation(
    () => new Promise<PageTestPage>((resolve) => answers.push(resolve)),
  );
  await click(el, "[data-test=print-test-page-pp2]");
  await vi.waitFor(() => expect(answers).toHaveLength(1));
  answers[0]!({ id: "tp1", status: "printing", hold: "paper_out" });
  await vi.waitFor(() =>
    expect(testPageNote(el)).toBe(
      fill("printers.test_page_held", { reason: t("printers.test_page_hold_paper_out") }),
    ),
  );
  await vi.waitFor(() => expect(answers).toHaveLength(2));
  answers[1]!({ id: "tp1", status: "printing" });
  await vi.waitFor(() => expect(testPageNote(el)).toBe(t("printers.test_page_printing")));
  expect(button(el, "[data-test=print-test-page-pp2]").disabled).toBe(true);
  await vi.waitFor(() => expect(answers).toHaveLength(3));
});

it("offers no test page on a disabled row", async () => {
  const { el, api } = await mount();
  const action = button(el, "[data-test=print-test-page-pp3]");
  expect(action.disabled).toBe(true);
  expect(action.variant).toBe("secondary");
  await click(el, "[data-test=print-test-page-pp3]");
  expect(api.printPagePrinterTestPage).not.toHaveBeenCalled();
});

it("shows a refused test page as the panel's alert and leaves the button usable", async () => {
  const { el, api } = await mount();
  api.printPagePrinterTestPage.mockRejectedValueOnce({ code: "page_printer.not_found" });
  await click(el, "[data-test=print-test-page-pp2]");
  expect(text(el, "[data-test=page-printers-action-error]")).toBe(
    codeMessage("page_printer.not_found"),
  );
  expect(q(el, "[data-test=page-printer-test-page-pp2]")).toBeNull();
  expect(button(el, "[data-test=print-test-page-pp2]").disabled).toBe(false);
  expect(api.background.readPagePrinterTestPage).not.toHaveBeenCalled();
});

it("keeps the page through a failed outcome read, shows it as a load failure, and clears it on the next read", async () => {
  const { el, api } = await mount();
  let answer!: (page: PageTestPage) => void;
  api.background.readPagePrinterTestPage
    .mockRejectedValueOnce({ code: "connection.failed" })
    .mockReturnValueOnce(
      new Promise<PageTestPage>((resolve) => {
        answer = resolve;
      }),
    );
  await click(el, "[data-test=print-test-page-pp2]");
  await vi.waitFor(() =>
    expect(text(el, "[data-test=page-printers-read-error]")).toBe(
      `${t("printers.refresh_failed")} ${codeMessage("connection.failed")}`,
    ),
  );
  expect(q(el, "[data-test=page-printers-action-error]")).toBeNull();
  expect(testPageNote(el)).toBe(t("printers.test_page_waiting"));
  expect(button(el, "[data-test=print-test-page-pp2]").disabled).toBe(true);
  await vi.waitFor(() => expect(api.background.readPagePrinterTestPage).toHaveBeenCalledTimes(2));

  answer({ id: "tp1", status: "sent" });
  await vi.waitFor(() => expect(testPageNote(el)).toBe(t("printers.test_page_printed")));
  expect(q(el, "[data-test=page-printers-read-error]")).toBeNull();
  expect(button(el, "[data-test=print-test-page-pp2]").disabled).toBe(false);
  expect(api.printPagePrinterTestPage).toHaveBeenCalledTimes(1);
});

it("leaves a failed list refresh's message in place when a test page's read succeeds", async () => {
  const { el, api, reload } = await mount();
  reload.mockRejectedValueOnce({ code: "connection.failed" });
  let answer!: (page: PageTestPage) => void;
  api.background.readPagePrinterTestPage.mockReturnValueOnce(
    new Promise<PageTestPage>((resolve) => {
      answer = resolve;
    }),
  );
  await click(el, "[data-test=print-test-page-pp1]");
  await vi.waitFor(() => expect(api.background.readPagePrinterTestPage).toHaveBeenCalled());
  await click(el, "[data-test=disable-page-printer-pp2]");
  await vi.waitFor(() => expect(q(el, "[data-test=page-printers-read-error]")).not.toBeNull());

  answer({ id: "tp1", status: "sent" });
  await vi.waitFor(() => expect(testPageNote(el, "pp1")).toBe(t("printers.test_page_printed")));
  expect(q(el, "[data-test=page-printers-read-error]")).not.toBeNull();
});

it("keeps a list refresh's failure that lands after a test page's failed read, when that page's next read succeeds", async () => {
  const { el, api, reload } = await mount();
  let failRead!: (error: unknown) => void;
  let answerRead!: (page: PageTestPage) => void;
  api.background.readPagePrinterTestPage
    .mockReturnValueOnce(
      new Promise<PageTestPage>((_, reject) => {
        failRead = reject;
      }),
    )
    .mockReturnValueOnce(
      new Promise<PageTestPage>((resolve) => {
        answerRead = resolve;
      }),
    );
  let failReload!: (error: unknown) => void;
  reload.mockReturnValueOnce(
    new Promise<void>((_, reject) => {
      failReload = reject;
    }),
  );
  const readError = () => text(el, "[data-test=page-printers-read-error]");

  await click(el, "[data-test=print-test-page-pp1]");
  await vi.waitFor(() => expect(api.background.readPagePrinterTestPage).toHaveBeenCalledTimes(1));
  await click(el, "[data-test=disable-page-printer-pp2]");
  await vi.waitFor(() => expect(reload).toHaveBeenCalled());
  failRead({ code: "page_printer.not_found" });
  await vi.waitFor(() =>
    expect(readError()).toBe(
      `${t("printers.refresh_failed")} ${codeMessage("page_printer.not_found")}`,
    ),
  );
  failReload({ code: "connection.failed" });
  await vi.waitFor(() =>
    expect(readError()).toBe(`${t("printers.refresh_failed")} ${codeMessage("connection.failed")}`),
  );
  await vi.waitFor(() => expect(api.background.readPagePrinterTestPage).toHaveBeenCalledTimes(2));

  answerRead({ id: "tp1", status: "sent" });
  await vi.waitFor(() => expect(testPageNote(el, "pp1")).toBe(t("printers.test_page_printed")));
  expect(readError()).toBe(`${t("printers.refresh_failed")} ${codeMessage("connection.failed")}`);
});

it("leaves one printer's failed read in place when another printer's read succeeds", async () => {
  const { el, api } = await mount();
  let failed = false;
  let answerOther!: (page: PageTestPage) => void;
  api.background.readPagePrinterTestPage.mockImplementation((id) => {
    if (id === "pp2")
      return new Promise<PageTestPage>((resolve) => {
        answerOther = resolve;
      });
    if (failed) return new Promise<PageTestPage>(() => {});
    failed = true;
    return Promise.reject({ code: "connection.failed" });
  });
  await click(el, "[data-test=print-test-page-pp2]");
  await vi.waitFor(() =>
    expect(api.background.readPagePrinterTestPage).toHaveBeenCalledWith("pp2"),
  );
  await click(el, "[data-test=print-test-page-pp1]");
  await vi.waitFor(() => expect(q(el, "[data-test=page-printers-read-error]")).not.toBeNull());

  answerOther({ id: "tp2", status: "sent" });
  await vi.waitFor(() => expect(testPageNote(el, "pp2")).toBe(t("printers.test_page_printed")));
  expect(text(el, "[data-test=page-printers-read-error]")).toBe(
    `${t("printers.refresh_failed")} ${codeMessage("connection.failed")}`,
  );
});

it("drops the row's note when the server no longer holds the page", async () => {
  const { el, api } = await mount();
  api.background.readPagePrinterTestPage.mockResolvedValue(null);
  await click(el, "[data-test=print-test-page-pp2]");
  await vi.waitFor(() => expect(q(el, "[data-test=page-printer-test-page-pp2]")).toBeNull());
  expect(button(el, "[data-test=print-test-page-pp2]").disabled).toBe(false);
});

it("stops reading while it is out of the page and picks the page up again when put back", async () => {
  const { el, api } = await mount({ testPagePollMs: 30 } as Partial<PagePrintersPanel>);
  api.background.readPagePrinterTestPage.mockResolvedValue({ id: "tp1", status: "sent" });
  await click(el, "[data-test=print-test-page-pp2]");
  const parent = el.parentElement!;
  el.remove();
  await new Promise((resolve) => setTimeout(resolve, 60));
  expect(api.background.readPagePrinterTestPage).not.toHaveBeenCalled();
  parent.append(el);
  await vi.waitFor(() => expect(testPageNote(el)).toBe(t("printers.test_page_printed")));
  expect(api.background.readPagePrinterTestPage).toHaveBeenCalledTimes(1);
});

it("drops a read that was out when it left the page, and reads once more when put back", async () => {
  const { el, api } = await mount();
  let answer!: (page: PageTestPage) => void;
  api.background.readPagePrinterTestPage
    .mockReturnValueOnce(
      new Promise<PageTestPage>((resolve) => {
        answer = resolve;
      }),
    )
    .mockResolvedValue({ id: "tp1", status: "sent" });
  await click(el, "[data-test=print-test-page-pp2]");
  await vi.waitFor(() => expect(api.background.readPagePrinterTestPage).toHaveBeenCalledTimes(1));
  const parent = el.parentElement!;
  el.remove();
  parent.append(el);
  answer({ id: "tp1", status: "printing" });

  await vi.waitFor(() => expect(testPageNote(el)).toBe(t("printers.test_page_printed")));
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(api.background.readPagePrinterTestPage).toHaveBeenCalledTimes(2);
  expect(testPageNote(el)).toBe(t("printers.test_page_printed"));
});
