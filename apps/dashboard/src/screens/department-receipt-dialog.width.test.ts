import { afterEach, beforeEach, expect, it } from "vitest";
import { page } from "vitest/browser";
import { chooseOption } from "@waitron/ui/src/test-helpers.js";
import type { DepartmentReceiptWrite } from "@waitron/shared";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import {
  deferred,
  mountReceiptDialog,
  preview,
  receiptApi,
  receiptModel,
} from "../testing/department-receipt-dialog-fixture.js";
import type { DepartmentReceiptDialog } from "./department-receipt-dialog.js";

beforeEach(() => setLocale("en-GB"));
afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});

it.each([1280, 390])(
  "at %ipx the dialog opens at its final width and keeps it, and the fields keep theirs, as the receipt, its preview and a narrower paper arrive",
  async (width) => {
    const before = { width: innerWidth, height: innerHeight };
    await page.viewport(width, 900);
    try {
      const api = receiptApi();
      const read = deferred<typeof receiptModel>();
      api.getDepartmentReceipt.mockImplementationOnce(() => read.promise);
      const drawn = deferred<ReturnType<typeof preview>>();
      api.previewReceiptDraft.mockImplementation(
        (input: DepartmentReceiptWrite & { paperWidth?: string }) => {
          if (input.paperWidth !== "58mm") return drawn.promise;
          const answer = preview();
          return Promise.resolve({
            ...answer,
            paperWidth: "58mm" as const,
            preview: { ...answer.preview, columns: 30, widthDots: 384 },
          });
        },
      );
      const { el: app } = await mountWidget<HTMLElement & { api: typeof api }>(
        "receipt-dialog-test-host",
        { api },
      );
      const el = app.shadowRoot!.querySelector<DepartmentReceiptDialog>(
        "dashboard-department-receipt-dialog",
      )!;
      await el.updateComplete;
      el.show({ id: "bar", name: "Bar" });
      const native = () =>
        el.shadowRoot!.querySelector("wt-modal")?.shadowRoot?.querySelector("dialog");
      await expect.poll(() => native()?.matches(":modal")).toBe(true);
      const opening = native()!.getBoundingClientRect().width;
      read.resolve(structuredClone(receiptModel));
      await expect.poll(() => el.shadowRoot!.querySelector("[name=email]")).toBeTruthy();
      await expect.poll(() => api.previewReceiptDraft.mock.calls.length).toBe(1);
      const fields = () => el.shadowRoot!.querySelector(".fields")!.getBoundingClientRect().width;
      expect(el.shadowRoot!.querySelector(".paper")).toBeNull();
      const loaded = { dialog: native()!.getBoundingClientRect().width, fields: fields() };
      expect(loaded.dialog).toBeCloseTo(opening, 0);
      drawn.resolve(preview());
      await expect.poll(() => el.shadowRoot!.querySelector(".paper")).toBeTruthy();
      expect(native()!.getBoundingClientRect().width).toBeCloseTo(loaded.dialog, 0);
      expect(fields()).toBeCloseTo(loaded.fields, 0);
      await chooseOption(el.shadowRoot!.querySelector("wt-combobox[name=previewWidth]")!, "58mm");
      await expect
        .poll(() => el.shadowRoot!.querySelector<HTMLElement>(".paper")?.style.width)
        .toBe("30ch");
      expect(fields()).toBeCloseTo(loaded.fields, 0);
      expect(native()!.getBoundingClientRect().width).toBeCloseTo(loaded.dialog, 0);
    } finally {
      await page.viewport(before.width, before.height);
    }
  },
);

it("shows no copy of the saved address, and says so when there is none", async () => {
  const { el, api } = await mountReceiptDialog(
    receiptApi({ ...receiptModel, venueAddress: ["Calle Mayor 1", "28013 Madrid"] }),
  );
  await expect.poll(() => el.shadowRoot!.querySelector(".paper")).toBeTruthy();
  expect(el.shadowRoot!.textContent).not.toContain("Calle Mayor 1");
  expect(el.shadowRoot!.textContent).not.toContain("28013 Madrid");
  api.getDepartmentReceipt.mockResolvedValue({ ...receiptModel, venueAddress: [] });
  api.liveData.invalidate([{ type: "locations" }]);
  await expect
    .poll(() => el.shadowRoot!.querySelector("[data-test=venue-address]")?.textContent?.trim())
    .toBe(t("receipts.no_address"));
});

it("does not say the languages are available at the till", async () => {
  const { el } = await mountReceiptDialog();
  expect(el.shadowRoot!.textContent).not.toContain("Available at the till.");
});

it.each([1280, 390])(
  "at %ipx a wide logo leaves the dialog at its no-logo width",
  async (width) => {
    const before = { width: innerWidth, height: innerHeight };
    await page.viewport(width, 900);
    try {
      const dialogWidth = (el: DepartmentReceiptDialog) =>
        el
          .shadowRoot!.querySelector("wt-modal")!
          .shadowRoot!.querySelector("dialog")!
          .getBoundingClientRect().width;
      const plain = await mountReceiptDialog();
      const without = dialogWidth(plain.el);
      cleanupWidgets();
      const { el } = await mountReceiptDialog(
        receiptApi({ ...receiptModel, receipt: { ...receiptModel.receipt, logo: "wide.png" } }),
      );
      const upload = el.shadowRoot!.querySelector("dashboard-image-upload")!;
      await upload.updateComplete;
      const img = upload.shadowRoot!.querySelector<HTMLImageElement>(
        "[data-test=choose-image] img",
      )!;
      const canvas = document.createElement("canvas");
      canvas.width = 2000;
      canvas.height = 600;
      canvas.getContext("2d")!.fillRect(0, 0, 2000, 600);
      const loaded = new Promise((resolve) =>
        img.addEventListener("load", resolve, { once: true }),
      );
      img.src = canvas.toDataURL("image/png");
      await loaded;
      expect(img.naturalWidth).toBe(2000);
      expect(dialogWidth(el)).toBeCloseTo(without, 0);
      const fields = el.shadowRoot!.querySelector(".fields")!.getBoundingClientRect();
      expect(img.getBoundingClientRect().right).toBeLessThanOrEqual(fields.right);
    } finally {
      await page.viewport(before.width, before.height);
    }
  },
);
