import { afterEach, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { setLocale } from "../i18n/t.js";
import { DashboardApi, type InvoiceCustomerSearchDto } from "../api/client.js";
import type { InvoiceCustomerDialog } from "./invoice-customer-dialog.js";
import "./invoice-customer-dialog.js";

afterEach(() => {
  cleanupWidgets();
  vi.restoreAllMocks();
  setLocale("en-GB");
});
async function mount(find = vi.fn().mockResolvedValue({ taxId: " Ab-09 /xy ", invoices: [] })) {
  setLocale("en-GB");
  const download = vi.fn();
  const api = {
    findInvoiceCustomer: find,
    downloadInvoiceCustomerData: download,
  } as unknown as DashboardApi;
  const { el } = await mountWidget<InvoiceCustomerDialog>("dashboard-invoice-customer-dialog", {
    open: true,
    api,
  });
  return { el, find, download };
}
async function edit(el: InvoiceCustomerDialog, name: string, value: string) {
  const f = el.shadowRoot!.querySelector(`[name=${name}]`);
  expect(f, `rendered ${name}`).not.toBeNull();
  f!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
}
async function press(el: InvoiceCustomerDialog) {
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=find]")!.click();
  await el.updateComplete;
}
it("searches using exact foreign document text and explicit identity", async () => {
  const { el, find } = await mount();
  await edit(el, "identifierType", "passport");
  await edit(el, "identifierCountryCode", "FR");
  await edit(el, "taxId", " Ab-09 /xy ");
  await press(el);
  expect(find).toHaveBeenCalledExactlyOnceWith(" Ab-09 /xy ", {
    identifierType: "passport",
    identifierCountryCode: "FR",
  });
});
it.each(["identifierType", "identifierCountryCode", "taxId"])(
  "discards delayed search replies after a %s edit",
  async (field) => {
    let resolve!: (v: InvoiceCustomerSearchDto) => void;
    const find = vi.fn(
      () =>
        new Promise<InvoiceCustomerSearchDto>((r) => {
          resolve = r;
        }),
    );
    const { el } = await mount(find);
    await edit(el, "identifierType", "passport");
    await edit(el, "identifierCountryCode", "FR");
    await edit(el, "taxId", "P123");
    await press(el);
    await edit(
      el,
      field,
      field === "identifierType"
        ? "other-document"
        : field === "identifierCountryCode"
          ? "GB"
          : " P123 ",
    );
    resolve({ taxId: "P123", invoices: [] });
    await el.updateComplete;
    await Promise.resolve();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("[data-test=none]")).toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test=download]")).toBeNull();
  },
);
it("keeps document validation local and field-specific without normalizing foreign punctuation", async () => {
  const { el, find } = await mount();
  await edit(el, "identifierType", "passport");
  await edit(el, "taxId", "P-123");
  await press(el);
  expect(find).not.toHaveBeenCalled();
  expect(
    el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>(
      "[name=identifierCountryCode]",
    )!.error,
  ).not.toBe("");
  await edit(el, "identifierCountryCode", "ES");
  await press(el);
  expect(find).toHaveBeenCalledExactlyOnceWith("P-123", {
    identifierType: "passport",
    identifierCountryCode: "ES",
  });
});

it.each(["identifierType", "identifierCountryCode", "taxId"])(
  "drops a completed download after a %s edit",
  async (field) => {
    let resolve!: (v: { blob: Blob; fileName: string }) => void;
    const { el, find, download } = await mount(
      vi.fn().mockResolvedValue({
        taxId: "P123",
        invoices: [
          { invoice: "F1-1", issuedAt: "2026-10-28T10:00:00Z", name: "Guest", total: "1.00" },
        ],
      }),
    );
    download.mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const objectUrl = vi.spyOn(URL, "createObjectURL");
    await edit(el, "identifierType", "passport");
    await edit(el, "identifierCountryCode", "FR");
    await edit(el, "taxId", " Ab-09 /xy ");
    await press(el);
    await expect.poll(() => el.shadowRoot!.querySelector("[data-test=download]")).not.toBeNull();
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=download]")!.click();
    await el.updateComplete;
    expect(find).toHaveBeenCalledExactlyOnceWith(" Ab-09 /xy ", {
      identifierType: "passport",
      identifierCountryCode: "FR",
    });
    expect(download).toHaveBeenCalledExactlyOnceWith(" Ab-09 /xy ", {
      identifierType: "passport",
      identifierCountryCode: "FR",
    });
    await edit(
      el,
      field,
      field === "identifierType"
        ? "other-document"
        : field === "identifierCountryCode"
          ? "GB"
          : " Ab-09 /xy  ",
    );
    resolve({ blob: new Blob(["zip"]), fileName: "old.zip" });
    await Promise.resolve();
    await el.updateComplete;
    expect(objectUrl).not.toHaveBeenCalled();
    expect(el.shadowRoot!.querySelector("[data-test=download]")).toBeNull();
  },
);

it("explains that foreign no-match searches preserve exact document text", async () => {
  const { el } = await mount();
  await edit(el, "identifierType", "passport");
  await edit(el, "identifierCountryCode", "FR");
  await edit(el, "taxId", "P123");
  await press(el);
  await expect
    .poll(() => el.shadowRoot!.querySelector("[data-test=none]")?.textContent)
    .toContain("exact number");
  expect(el.shadowRoot!.querySelector("[data-test=none]")!.textContent).not.toContain(
    "make no difference",
  );
});
